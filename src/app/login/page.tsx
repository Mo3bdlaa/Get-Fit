import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { loginAction } from "@/app/actions";
import { currentUser } from "@/lib/auth/current";
import { DEFAULT_LOCALE, messages } from "@/lib/i18n";

export default async function LoginPage() {
  if (await currentUser()) redirect("/log");
  return <AuthForm mode="login" action={loginAction} m={messages(DEFAULT_LOCALE)} />;
}
