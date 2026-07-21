"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { text, type Language, type UiText } from "@/lib/ui-text";

type Theme = "light" | "dark";

type Preferences = {
  language: Language;
  theme: Theme;
  t: UiText;
  toggleLanguage: () => void;
  toggleTheme: () => void;
};

const PreferencesContext = createContext<Preferences | null>(null);

function storedLanguage(): Language {
  if (typeof window === "undefined") return "zh";
  return localStorage.getItem("language") === "en" ? "en" : "zh";
}

function storedTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(storedLanguage);
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    localStorage.setItem("language", language);
  }, [language]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  const value = useMemo<Preferences>(() => ({
    language,
    theme,
    t: text[language],
    toggleLanguage: () => setLanguage((current) => (current === "zh" ? "en" : "zh")),
    toggleTheme: () => setTheme((current) => (current === "light" ? "dark" : "light")),
  }), [language, theme]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function useAppPreferences() {
  const preferences = useContext(PreferencesContext);
  if (!preferences) throw new Error("useAppPreferences must be used inside AppPreferencesProvider");
  return preferences;
}
