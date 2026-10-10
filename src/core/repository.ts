import Dexie, { type Table } from "dexie";
import {
  cleanFields,
  tokens,
  searchable,
  normal,
  identityMatches,
  identityKeys,
  combine,
  type Fields,
  type Person,
  type DocumentRecord,
  type Source,
  type ConflictChoice,
} from "./model";
export interface ImportDecision {
  fields: Fields;
  action: "create" | "update" | "skip";
  targetId?: string;
  revision?: number;
  choices?: Record<string, ConflictChoice>;
  review?: boolean;
}
export interface ImportSummary {
  created: number;
  updated: number;
  review: number;
  skipped: number;
}
export interface ProfileRepository {
  search(
    query: string,
    offset?: number,
    limit?: number,
  ): Promise<{ items: Person[]; total: number }>;
  get(id: string): Promise<Person | undefined>;
  save(
    fields: Fields,
    options?: {
      id?: string;
      revision?: number;
      source?: Source;
      status?: Person["status"];
    },
  ): Promise<Person>;
  remove(id: string): Promise<void>;
  matches(fields: Fields): Promise<{ person: Person; reasons: string[] }[]>;
  analyze(
    records: Fields[],
  ): Promise<{ person: Person; reasons: string[] }[][]>;
  merge(
    targetId: string,
    sourceId: string,
    targetRevision: number,
    sourceRevision: number,
    choices: Record<string, ConflictChoice>,
  ): Promise<Person>;
  all(): Promise<Person[]>;
  stats(): Promise<{
    total: number;
    review: number;
    documents: DocumentRecord[];
  }>;
  clear(): Promise<void>;
  getSetting(key: string): Promise<unknown>;
  migrateLegacy(fields?: Fields, answers?: unknown): Promise<void>;
  commitImport(
    id: string,
    name: string,
    records: ImportDecision[],
    warnings: string[],
  ): Promise<ImportSummary>;
}
export class LocalRepository extends Dexie implements ProfileRepository {
  profiles!: Table<Person, string>;
  documents!: Table<DocumentRecord, string>;
  settings!: Table<{ key: string; value: unknown }, string>;
  constructor(name = "personal-assist-v2") {
    super(name);
    this.version(1).stores({
      profiles: "id,updatedAt,status,*searchTokens",
      documents: "id,&fingerprint,importedAt",
      settings: "key",
    });
    this.version(2)
      .stores({
        profiles: "id,updatedAt,status,*searchTokens,*identityKeys",
        documents: "id,&fingerprint,importedAt",
        settings: "key",
      })
      .upgrade((tx) =>
        tx
          .table("profiles")
          .toCollection()
          .modify((person: Person) => {
            person.identityKeys = identityKeys(person.fields);
          }),
      );
  }
  async getSetting(key: string) {
    return (await this.settings.get(key))?.value;
  }
  async migrateLegacy(fields?: Fields, answers?: unknown) {
    await this.transaction("rw", this.profiles, this.settings, async () => {
      if (await this.getSetting("legacyMigration")) return;
      if (fields && Object.keys(fields).length)
        await this.save(fields, {
          status: "review",
          source: {
            name: "Legacy single profile",
            at: new Date().toISOString(),
            fields: Object.keys(fields),
          },
        });
      if (answers)
        await this.settings.put({ key: "legacyAnswers", value: answers });
      await this.settings.put({ key: "legacyMigration", value: true });
    });
  }
  async search(query: string, offset = 0, limit = 20) {
    const q = normal(query);
    const term = q.replace(/[()+.\s-]/g, "");
    const searchTerm = /^[\d()+.\s-]+$/.test(q) ? term : q;
    const start = Math.max(0, offset),
      size = Math.min(50, Math.max(1, limit));
    return this.transaction("r", this.profiles, async () => {
      if (!searchTerm)
        return {
          items: await this.profiles
            .orderBy("updatedAt")
            .reverse()
            .offset(start)
            .limit(size)
            .toArray(),
          total: await this.profiles.count(),
        };
      // Sample prefix/middle/suffix indexes. A rare trigram avoids decoding all
      // profiles that share a common name/email prefix. Verify full substrings.
      const grams = [
        ...new Set([
          searchTerm.slice(0, 3),
          searchTerm.slice(
            Math.max(0, Math.floor((searchTerm.length - 3) / 2)),
            Math.max(0, Math.floor((searchTerm.length - 3) / 2)) + 3,
          ),
          searchTerm.slice(-3),
        ]),
      ];
      let gram = grams[0];
      if (grams.length > 1) {
        const counts = await Promise.all(
          grams.map((key) =>
            this.profiles.where("searchTokens").equals(key).count(),
          ),
        );
        const smallest = Math.min(...counts);
        if (!smallest) return { items: [], total: 0 };
        gram = grams[counts.indexOf(smallest)];
      }
      const items: Person[] = [];
      let total = 0;
      await this.profiles
        .where("searchTokens")
        .equals(gram)
        .each((person) => {
          if (!searchable(person.fields).includes(searchTerm)) return;
          if (total >= start && items.length < size) items.push(person);
          total++;
        });
      return { items, total };
    });
  }
  get(id: string) {
    return this.profiles.get(id);
  }
  async save(
    fields: Fields,
    options: {
      id?: string;
      revision?: number;
      source?: Source;
      status?: Person["status"];
    } = {},
  ) {
    return this.transaction("rw", this.profiles, async () => {
      const old = options.id ? await this.get(options.id) : undefined;
      if (options.id && (!old || old.revision !== options.revision))
        throw new Error(
          "Profile changed in another window. Reopen it before saving.",
        );
      const cleaned = cleanFields(fields);
      if (!Object.keys(cleaned).length)
        throw new Error("Enter at least one profile detail.");
      const at = new Date().toISOString();
      const p: Person = {
        id: old?.id || crypto.randomUUID(),
        schemaVersion: 1,
        revision: (old?.revision || 0) + 1,
        fields: cleaned,
        status: options.status || "verified",
        sources: [
          ...(old?.sources || []),
          ...(options.source ? [options.source] : []),
        ].slice(-100),
        createdAt: old?.createdAt || at,
        updatedAt: at,
        searchTokens: tokens(cleaned),
        identityKeys: identityKeys(cleaned),
      };
      await this.profiles.put(p);
      return p;
    });
  }
  async remove(id: string) {
    await this.profiles.delete(id);
  }
  async matches(fields: Fields) {
    return this.transaction("r", this.profiles, () => this.findMatches(fields));
  }
  private async findMatches(
    fields: Fields,
    cache?: Map<string, Promise<Person[]>>,
  ) {
    const candidates = new Map<string, Person>();
    for (const key of identityKeys(cleanFields(fields))) {
      let result = cache?.get(key);
      if (!result) {
        result = this.profiles
          .where("identityKeys")
          .equals(key)
          .limit(50)
          .toArray();
        if (cache) {
          if (cache.size >= 256) cache.delete(cache.keys().next().value!);
          cache.set(key, result);
        }
      }
      for (const person of await result) candidates.set(person.id, person);
    }
    return [...candidates.values()]
      .map((person) => ({
        person,
        reasons: identityMatches(person.fields, fields),
      }))
      .filter((x) => x.reasons.length);
  }
  async analyze(records: Fields[]) {
    if (!Array.isArray(records) || records.length > 10000)
      throw new Error("Invalid import batch.");
    return this.transaction("r", this.profiles, async () => {
      if (!(await this.profiles.count())) return records.map(() => []);
      const cache = new Map<string, Promise<Person[]>>();
      const result: { person: Person; reasons: string[] }[][] = [];
      // Bounded concurrency; lookup reuse lasts only for this read snapshot.
      for (let i = 0; i < records.length; i += 8)
        result.push(
          ...(await Promise.all(
            records
              .slice(i, i + 8)
              .map((fields) => this.findMatches(fields, cache)),
          )),
        );
      return result;
    });
  }
  async merge(
    targetId: string,
    sourceId: string,
    targetRevision: number,
    sourceRevision: number,
    choices: Record<string, ConflictChoice>,
  ) {
    if (targetId === sourceId)
      throw new Error("Select two different profiles.");
    return this.transaction("rw", this.profiles, async () => {
      const target = await this.get(targetId),
        source = await this.get(sourceId);
      if (
        !target ||
        !source ||
        target.revision !== targetRevision ||
        source.revision !== sourceRevision
      )
        throw new Error("A profile changed. Review both profiles again.");
      const p = await this.save(
        combine(target.fields, source.fields, choices),
        { id: target.id, revision: target.revision, status: "verified" },
      );
      p.sources = [...target.sources, ...source.sources].slice(-100);
      await this.profiles.put(p);
      await this.profiles.delete(sourceId);
      return p;
    });
  }
  all() {
    return this.profiles.toArray();
  }
  async stats() {
    return {
      total: await this.profiles.count(),
      review: await this.profiles.where("status").equals("review").count(),
      documents: await this.documents
        .orderBy("importedAt")
        .reverse()
        .limit(10)
        .toArray(),
    };
  }
  async clear() {
    await this.transaction(
      "rw",
      this.profiles,
      this.documents,
      this.settings,
      async () => {
        await this.profiles.clear();
        await this.documents.clear();
        await this.settings.clear();
        await this.settings.put({ key: "legacyMigration", value: true });
      },
    );
  }
  async commitImport(
    id: string,
    name: string,
    records: {
      fields: Fields;
      action: "create" | "update" | "skip";
      targetId?: string;
      revision?: number;
      choices?: Record<string, ConflictChoice>;
      review?: boolean;
    }[],
    warnings: string[],
  ) {
    if (records.length > 10000)
      throw new Error("Import at most 10,000 records at a time.");
    return this.transaction("rw", this.profiles, this.documents, async () => {
      if (await this.documents.where("fingerprint").equals(id).count())
        throw new Error(
          "This exact document was already imported. No duplicate writes were made.",
        );
      const summary = { created: 0, updated: 0, review: 0, skipped: 0 };
      const at = new Date().toISOString(),
        documentId = crypto.randomUUID();
      for (const row of records) {
        if (!["create", "update", "skip"].includes(row.action))
          throw new Error("Every imported record requires a decision.");
        if (row.action === "skip") {
          summary.skipped++;
          continue;
        }
        let fields = cleanFields(row.fields);
        if (row.action === "update") {
          const old = row.targetId ? await this.get(row.targetId) : undefined;
          if (!old || old.revision !== row.revision)
            throw new Error("An import target changed. Reopen import review.");
          fields = combine(old.fields, fields, row.choices || {});
        }
        await this.save(fields, {
          id: row.action === "update" ? row.targetId : undefined,
          revision: row.revision,
          status: row.review ? "review" : "verified",
          source: { documentId, name, at, fields: Object.keys(row.fields) },
        });
        summary[row.action === "create" ? "created" : "updated"]++;
        if (row.review) summary.review++;
      }
      await this.documents.add({
        id: documentId,
        name,
        fingerprint: id,
        importedAt: at,
        count: summary.created + summary.updated,
        warnings: warnings.slice(0, 100),
      });
      return summary;
    });
  }
}
