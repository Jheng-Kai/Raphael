import { zhTW, type MessageKey } from "./zh-TW";
import { en } from "./en";
import { ja } from "./ja";
import { zhCN } from "./zh-CN";
import { ko } from "./ko";
import { es } from "./es";
import { fr } from "./fr";
import { de } from "./de";
import { ptBR } from "./pt-BR";
import { it } from "./it";
import { ru } from "./ru";
import { vi } from "./vi";
import { th } from "./th";
import { id } from "./id";
import { tr } from "./tr";
import "./fonts.css";

export const LOCALES = [
  { id: "zh-TW", native: zhTW["settings.023"], english: "Traditional Chinese" },
  { id: "en", native: en["locale.english"], english: "English" },
  { id: "ja", native: ja["settings.024"], english: "Japanese" },
  { id: "zh-CN", native: "简体中文", english: "Simplified Chinese" },
  { id: "ko", native: "한국어", english: "Korean" },
  { id: "es", native: "Español", english: "Spanish" },
  { id: "fr", native: "Français", english: "French" },
  { id: "de", native: "Deutsch", english: "German" },
  { id: "pt-BR", native: "Português (Brasil)", english: "Portuguese (Brazil)" },
  { id: "it", native: "Italiano", english: "Italian" },
  { id: "ru", native: "Русский", english: "Russian" },
  { id: "vi", native: "Tiếng Việt", english: "Vietnamese" },
  { id: "th", native: "ไทย", english: "Thai" },
  { id: "id", native: "Bahasa Indonesia", english: "Indonesian" },
  { id: "tr", native: "Türkçe", english: "Turkish" },
] as const;
export type UiLocale = (typeof LOCALES)[number]["id"];
export const catalogs = { "zh-TW": zhTW, en, ja, "zh-CN": zhCN, ko, es, fr, de, "pt-BR": ptBR, it, ru, vi, th, id, tr };
let locale: UiLocale = "zh-TW";
const listeners = new Set<() => void>();

export const getLocale = (): UiLocale => locale;
export const isUiLocale = (value: unknown): value is UiLocale => typeof value === "string" && Object.prototype.hasOwnProperty.call(catalogs, value);
type MessageValue = string | number | (() => string | number);
const rendered = new Map<string, { key: MessageKey; values?: Record<string, MessageValue> }>();

/** The persisted device setting is the authority; unknown legacy values use the default. */
export function setLocale(value: unknown): void {
  const next = isUiLocale(value) ? value : "zh-TW";
  if (typeof document !== "undefined") document.documentElement.lang = next;
  if (next === locale) return;
  locale = next;
  for (const listener of [...listeners]) {
    try { listener(); }
    catch (error) { console.warn("A locale listener could not refresh its surface", error); }
  }
}

export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

type Slots<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | Slots<Rest> : never;
type Values<K extends MessageKey> = Record<Slots<(typeof zhTW)[K]>, MessageValue>;

/** Interpolates once, so braces in a user's text are never interpreted as a second message. */
export function t<K extends MessageKey>(
  key: K,
  ...args: [Slots<(typeof zhTW)[K]>] extends [never] ? [values?: Values<K>] : [values: Values<K>]
): string {
  const message: string = catalogs[locale][key];
  const values = args[0] as Record<string, MessageValue> | undefined;
  const result = interpolate(message, values);
  rendered.set(result, { key, values });
  if (rendered.size > 512) rendered.delete(rendered.keys().next().value!);
  return result;
}

function interpolate(message: string, values?: Record<string, MessageValue>): string {
  return message.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values?.[name];
    return value === undefined ? match : String(typeof value === "function" ? value() : value);
  });
}

/** Keeps existing transient notices in sync; backend messages and user text stay as supplied. */
export function translatedMessage(message: string): () => string {
  const reference = rendered.get(message);
  return reference ? () => {
    const result = interpolate(catalogs[locale][reference.key], reference.values);
    rendered.set(result, reference);
    if (rendered.size > 512) rendered.delete(rendered.keys().next().value!);
    return result;
  } : () => message;
}
