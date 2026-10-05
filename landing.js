// The landing page's before/after slider. Drag (or tap) anywhere on the
// picture to move the line; the hidden range input lets keyboards and screen
// readers move it too. "Show changes" swaps the after photo for the tool's
// result with the coloured change squares.

const compare = document.getElementById("compare");
const compareRange = document.getElementById("compare-range");
const afterImage = document.getElementById("compare-after");
const changesButton = document.getElementById("compare-changes");
const afterLabel = document.querySelector(".compare-label-after");
let dragging = false;

// Moves the line to "percent" of the way across (0 = all after, 100 = all before)
function setPosition(percent) {
  percent = Math.max(0, Math.min(100, percent));
  compare.style.setProperty("--position", percent + "%");
  compareRange.value = Math.round(percent);
}

function positionFromPointer(event) {
  const box = compare.getBoundingClientRect();
  setPosition(((event.clientX - box.left) / box.width) * 100);
}

compare.addEventListener("pointerdown", function (event) {
  dragging = true;
  compare.setPointerCapture(event.pointerId);
  positionFromPointer(event);
});
compare.addEventListener("pointermove", function (event) {
  if (dragging) positionFromPointer(event);
});
compare.addEventListener("pointerup", function () { dragging = false; });
compare.addEventListener("pointercancel", function () { dragging = false; });

compareRange.addEventListener("input", function () {
  setPosition(Number(compareRange.value));
});

changesButton.addEventListener("click", function () {
  const showing = changesButton.getAttribute("aria-pressed") !== "true";
  changesButton.setAttribute("aria-pressed", showing ? "true" : "false");
  changesButton.textContent = showing ? "Hide changes" : "Show changes";
  afterImage.src = showing ? "docs/landing/hero-changes.jpg" : "docs/landing/hero-after.jpg";
  afterImage.alt = showing
    ? "After, with TerraShift's changes: blue squares on new earthworks and bare ground, and green where plants grew"
    : "After: Lulu Island, Abu Dhabi, on 29 September 2026, with new earthworks and a planted area";
  afterLabel.textContent = showing ? "After + changes" : "After · 29 Sep 2026";
});
