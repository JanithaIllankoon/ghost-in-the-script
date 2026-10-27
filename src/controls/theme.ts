import { getCurrentWindow } from "@tauri-apps/api/window";

type Theme = "light" | "dark";

const storageKey = "ghost-controls-theme";

function readTheme(): Theme {
  try {
    return localStorage.getItem(storageKey) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

let theme = readTheme();
document.documentElement.dataset.theme = theme;

export function initTheme() {
  const toggle = document.getElementById("theme-toggle")!;
  const label = document.getElementById("theme-label")!;
  const update = () => {
    document.documentElement.dataset.theme = theme;
    toggle.setAttribute("aria-checked", String(theme === "dark"));
    label.textContent = theme === "dark" ? "Dark mode" : "Light mode";
    toggle.title = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;
    getCurrentWindow().setTheme(theme).catch((error) => console.warn("Could not update the window theme", error));
  };
  update();
  toggle.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    update();
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      // The switch still works when browser storage is unavailable.
    }
  });
}
