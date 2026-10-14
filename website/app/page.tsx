import { requireChatGPTUser } from "./chatgpt-auth";
import { Dashboard } from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const publicReadings = process.env.VERCEL === "1";
  if (!publicReadings) await requireChatGPTUser("/");
  return <Dashboard publicReadings={publicReadings} />;
}
