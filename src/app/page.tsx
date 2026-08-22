import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current";

export default async function Home() {
  redirect((await currentUser()) ? "/log" : "/login");
}
