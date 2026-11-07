import { cookies } from "next/headers";
import { ok } from "@/lib/api";

export async function POST(req: Request) {
  const { lang } = await req.json();
  const jar = await cookies();
  jar.set("gt_lang", lang === "fr" ? "fr" : "en", { path: "/", maxAge: 60 * 60 * 24 * 365 });
  return ok();
}
