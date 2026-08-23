const en = {
  appName: "Get Fit",
  tagline: "Log every set. Watch the line go up.",
  notMedicalAdvice:
    "Get Fit is not medical advice. Stop and speak to a qualified professional if anything hurts.",

  navLog: "Log",
  navProgress: "Progress",
  navSignOut: "Sign out",

  authRegisterTitle: "Create your account",
  authLoginTitle: "Sign in",
  authEmail: "Email",
  authPassword: "Password",
  authDisplayName: "Name",
  authLanguage: "Language",
  authRegisterCta: "Create account",
  authLoginCta: "Sign in",
  authHaveAccount: "Already have an account?",
  authNeedAccount: "Need an account?",
  authInvalid: "That email and password combination is not recognised.",
  authEmailTaken: "That email address is already registered.",
  authPasswordTooShort: "Password must be at least 10 characters.",
  authInvalidEmail: "Enter a valid email address.",
  authNameRequired: "Enter a name.",

  logTitle: "Log a set",
  logExercise: "Exercise",
  logWeight: "Weight (kg)",
  logReps: "Reps",
  logRpe: "RPE (optional)",
  logNotes: "Notes (optional)",
  logSubmit: "Log set",
  logSaved: "Set logged.",
  logRecent: "Recent sets",
  logEmpty: "No sets yet. Your first one goes above.",
  logSetNumber: "Set",
  logUnknownExercise: "Pick an exercise from the catalogue.",
  logInvalidNumbers: "Enter a weight of 0 kg or more and at least 1 rep.",

  progressTitle: "Training volume",
  progressSubtitle: "Weight × reps, totalled per day.",
  progressEmpty: "Log a set and the chart appears here.",
  progressVolume: "Volume",
  progressSetsLabel: "Sets",
  progressKg: "kg",
} as const;

export default en;

/** The message *shape* — Arabic must supply every key, not the same strings. */
export type Messages = { [K in keyof typeof en]: string };
