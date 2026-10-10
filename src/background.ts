import { LocalRepository, type ProfileRepository } from "./core/repository";
import { cleanFields, type Fields } from "./core/model";
const repository: ProfileRepository = new LocalRepository();
const trusted = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id &&
  !sender.tab &&
  !!sender.url?.startsWith(chrome.runtime.getURL(""));
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
});
let migration: Promise<void> | undefined;
async function migrate() {
  migration ??= (async () => {
    const saved = await chrome.storage.local.get(["profile", "savedAnswers"]);
    await repository.migrateLegacy(
      saved.profile ? cleanFields(saved.profile) : undefined,
      saved.savedAnswers,
    );
    if (saved.profile || saved.savedAnswers) {
      await chrome.storage.local.remove(["profile", "savedAnswers"]);
      await chrome.storage.session.clear();
    }
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const ids = registered
      .filter((s) => s.id.startsWith("resumeportal"))
      .map((s) => s.id);
    if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
  })().catch((error) => {
    migration = undefined;
    throw error;
  });
  await migration;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!trusted(sender)) return; // Content scripts can never query the database.
  if (
    !message ||
    typeof message.type !== "string" ||
    !message.type.startsWith("DB_")
  )
    return;
  (async () => {
    try {
      await migrate();
      let result: unknown;
      switch (message.type) {
        case "DB_SEARCH":
          result = await repository.search(
            String(message.query || ""),
            Number(message.offset) || 0,
          );
          break;
        case "DB_GET":
          result = await repository.get(message.id);
          break;
        case "DB_SAVE":
          result = await repository.save(message.fields, {
            id: message.id,
            revision: message.revision,
            status: message.status || "verified",
            source: {
              name: message.source || "Manual edit",
              at: new Date().toISOString(),
              fields: Object.keys(message.fields || {}),
            },
          });
          break;
        case "DB_DELETE":
          await repository.remove(message.id);
          result = true;
          break;
        case "DB_MATCHES":
          result = await repository.matches(message.fields);
          break;
        case "DB_ANALYZE": {
          if (!Array.isArray(message.records) || message.records.length > 10000)
            throw new Error("Invalid import batch.");
          const hasProfiles = (await repository.stats()).total > 0;
          result = [];
          for (const fields of message.records)
            (result as unknown[]).push(
              hasProfiles ? await repository.matches(fields) : [],
            );
          break;
        }
        case "DB_MERGE":
          result = await repository.merge(
            message.targetId,
            message.sourceId,
            message.targetRevision,
            message.sourceRevision,
            message.choices,
          );
          break;
        case "DB_IMPORT":
          result = await repository.commitImport(
            message.fingerprint,
            message.name,
            message.records,
            message.warnings || [],
          );
          break;
        case "DB_STATS":
          result = await repository.stats();
          break;
        case "DB_EXPORT":
          result = {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            profiles: (await repository.all()).map(
              ({ searchTokens, ...person }) => person,
            ),
            legacyAnswers:
              (await repository.getSetting("legacyAnswers")) || undefined,
          };
          break;
        case "DB_CLEAR":
          await repository.clear();
          await chrome.storage.local.remove(["profile", "savedAnswers"]);
          await chrome.storage.session.clear();
          result = true;
          break;
        default:
          throw new Error("Unknown database operation.");
      }
      respond({ result });
    } catch (error) {
      respond({
        error:
          error instanceof Error
            ? error.message
            : "Local database unavailable.",
      });
    }
  })();
  return true;
});
