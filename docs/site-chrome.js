export function setupChrome() {
  function setupTheme() {
    const getStored = () => {
      try {
        return localStorage.getItem("theme") || "system";
      } catch {
        return "system";
      }
    };
    const applyTheme = (mode) => {
      if (mode === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
        document.documentElement.style.colorScheme = "dark";
      } else if (mode === "light") {
        document.documentElement.setAttribute("data-theme", "light");
        document.documentElement.style.colorScheme = "light";
      } else {
        document.documentElement.removeAttribute("data-theme");
        document.documentElement.style.colorScheme = "light dark";
      }
      document.querySelectorAll(".theme-btn").forEach((btn) => {
        const isActive = btn.dataset.themeValue === mode;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    };
    const setTheme = (mode) => {
      try {
        if (mode === "system") localStorage.removeItem("theme");
        else localStorage.setItem("theme", mode);
      } catch {}
      applyTheme(mode);
    };
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".theme-btn");
      if (btn && btn.dataset.themeValue) setTheme(btn.dataset.themeValue);
    });
    window.addEventListener("storage", (e) => {
      if (e.key === "theme") applyTheme(e.newValue || "system");
    });
    try {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", () => {
          if (getStored() === "system") applyTheme("system");
        });
    } catch {}
    applyTheme(getStored());
  }
  setupTheme();

  const menuToggle = document.querySelector("#menu-toggle");
  menuToggle?.addEventListener("click", () => {
    const open = menuToggle.getAttribute("aria-expanded") !== "true";
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute(
      "aria-label",
      open ? "Close navigation" : "Open navigation",
    );
    document.querySelector("#navigation").classList.toggle("is-open", open);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      menuToggle?.setAttribute("aria-expanded", "false");
      menuToggle?.setAttribute("aria-label", "Open navigation");
      document.querySelector("#navigation")?.classList.remove("is-open");
    }
  });

  const filterToggle = document.querySelector("#filter-toggle");
  filterToggle?.addEventListener("click", () => {
    const open = filterToggle.getAttribute("aria-expanded") !== "true";
    filterToggle.setAttribute("aria-expanded", String(open));
    document
      .querySelector("#catalog-filters")
      .classList.toggle("is-open", open);
    filterToggle.querySelector("span").textContent = open ? "−" : "+";
  });
}
