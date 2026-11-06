import { parseArgs } from "node:util";
import { fetchPage } from "../collect/index.js";
import { extractMedia } from "../collect/media.js";
import type { ArticlePayload } from "../tralked.js";
import { articleMedia, storyForWriting } from "../pipeline.js";
import { realDeps } from "./deps.js";
import { runIfMain } from "./run.js";

export const MIDIA_USAGE = "uso: pnpm midia -- --historia <id> [--historia <id>…]";

/** The story ids of `pnpm midia`. */
export function parseMidiaArgs(args: string[]): number[] {
  const { values } = parseArgs({ args, options: { historia: { type: "string", multiple: true } }, strict: true, allowPositionals: false });
  const ids = (values.historia ?? []).map(Number);
  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error(MIDIA_USAGE);
  return ids;
}

/**
 * `pnpm midia -- --historia <id>…`: the media choice of stories, without writing, publishing or sending
 * any image (the upload is faked). Prints the candidates (origin, size, repetition), the vision verdicts,
 * the cover, the body image or gallery with their credits, the video and the X posts. Pages read before
 * the robot kept media are fetched again (only into this database). Uses one or two vision calls per story.
 */
async function main(): Promise<void> {
  const ids = parseMidiaArgs(process.argv.slice(2).filter((a) => a !== "--"));
  const base = realDeps();
  const print = (line: string) => console.log(line);
  const deps = {
    ...base,
    log: (line: string) => print(`  ${line}`),
    mediaTrace: (line: string) => print(`  ${line}`),
    tralked: {
      ...base.tralked,
      uploadImage: async (_bytes: Uint8Array, _type: string, key: string) => ({ url: `https://envio-falso.tralked/${key}.webp` }),
    },
  };

  for (const id of ids) {
    const story = deps.db.storyById(id);
    if (!story) {
      print(`história ${id}: não existe neste banco`);
      continue;
    }
    print(`\n=== história ${id}: ${story.headline} (${story.status})`);
    for (const item of deps.db.itemsForStory(id)) {
      if (item.media_json !== null || item.text_unavailable === 1 || item.video_id) continue;
      try {
        const { text, finalUrl } = await fetchPage(item.url, deps.fetchFn);
        deps.db.setItemMedia(item.id, extractMedia(text, finalUrl));
      } catch (error) {
        print(`  página indisponível: ${item.url} (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    const writing = await storyForWriting(story, deps);
    print(`  jogos do catálogo: ${writing.candidates.map((c) => `${c.name} (${c.slug})`).join(", ") || "nenhum"}`);
    const payload = { games: writing.candidates.slice(0, 1).map((c) => ({ slug: c.slug })) } as ArticlePayload;
    const media = await articleMedia(story, writing, payload, deps);
    const credit = (m: { credit: string; creditUrl?: string }) => `${m.credit}${m.creditUrl ? ` → ${m.creditUrl}` : ""}`;
    print(`  CAPA: ${media.cover ? `${media.cover.alt} | ${credit(media.cover)}` : "nenhuma (o site usa o acervo ou a capa de reserva)"}`);
    if (media.gallery) print(`  GALERIA: ${media.gallery.length} imagens | ${credit(media.gallery[0]!)}`);
    else print(`  CORPO: ${media.bodyImage ? `${media.bodyImage.alt} | ${credit(media.bodyImage)}` : "nenhuma"}`);
    print(`  VÍDEO: ${media.video ? `${media.video.title} (https://www.youtube.com/watch?v=${media.video.youtubeId})` : "nenhum"}`);
    if (media.trailer) print(`  VÍDEO DO CATÁLOGO NO FIM: ${media.trailer.title}`);
    print(`  POSTS DO X: ${media.posts?.map((p) => `@${p.authorHandle} ${p.url}`).join(" | ") || "nenhum"}`);
  }
}

runIfMain(import.meta.url, main);
