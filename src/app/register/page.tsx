import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { registerAction } from "@/app/actions";
import { currentUser } from "@/lib/auth/current";
import { DEFAULT_LOCALE, messages } from "@/lib/i18n";

export default async function RegisterPage() {
  if (await currentUser()) redirect("/log");
  return (
    <AuthForm mode="register" action={registerAction} m={messages(DEFAULT_LOCALE)} />
  );
}
