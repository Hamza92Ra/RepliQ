const nav = document.getElementById("nav");
const tabs = Array.from(document.querySelectorAll("#bottomNav a"));
function updateNavigation() {
  nav?.classList.toggle("scrolled", window.scrollY > 30);
  let current = "top";
  for (const id of ["comment", "fonctionnalites", "tarifs", "faq"]) {
    const section = document.getElementById(id);
    if (section && section.getBoundingClientRect().top <= window.innerHeight * 0.35) current = id;
  }
  tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.target === current));
}
window.addEventListener("scroll", updateNavigation, { passive: true });
window.addEventListener("resize", updateNavigation);
updateNavigation();
document.querySelectorAll(".faq-item").forEach(item => {
  const button = item.querySelector(".faq-q");
  button.addEventListener("click", () => {
    const open = !item.classList.contains("open");
    document.querySelectorAll(".faq-item").forEach(other => {
      other.classList.remove("open");
      other.querySelector(".faq-q").setAttribute("aria-expanded", "false");
    });
    item.classList.toggle("open", open);
    button.setAttribute("aria-expanded", String(open));
  });
});
