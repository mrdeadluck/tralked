import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { buildRobots } from "@/lib/seo/robots";

export default function robots(): MetadataRoute.Robots {
  return buildRobots(env.APP_URL);
}
