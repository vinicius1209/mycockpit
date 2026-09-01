const params = new URLSearchParams(location.search)
const storedTheme = localStorage.getItem("incidente-mock-theme") || "light"
const storedMode = localStorage.getItem("incidente-mock-mode") || "limit"

function setTheme(theme) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem("incidente-mock-theme", theme)
  document.querySelectorAll("[data-set-theme]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.setTheme === theme)
  })
}

function setMode(mode) {
  document.documentElement.dataset.mode = mode
  localStorage.setItem("incidente-mock-mode", mode)
  document.querySelectorAll("[data-set-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.setMode === mode)
  })
}

document.querySelectorAll("[data-set-theme]").forEach((button) => {
  button.addEventListener("click", () => setTheme(button.dataset.setTheme))
})

document.querySelectorAll("[data-set-mode]").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.setMode))
})

setTheme(params.get("theme") || storedTheme)
setMode(params.get("mode") || storedMode)
