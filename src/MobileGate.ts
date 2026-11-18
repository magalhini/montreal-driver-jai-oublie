import "./ui/mobilegate.css";

/**
 * Montreal Driver is desktop only (keyboard or gamepad, and a GPU that can carry the city). Phones and tablets get
 * this page instead: a short note and the published promo shots (`public/screens`, made from `promo/screenshots`
 * by `scripts/mobile-screens.sh`). `boot.ts` decides; the game bundle never loads on a phone.
 */

/** Each shot carries the next beat of the drive, in order: what you're up against, not what's in the frame. */
const SHOTS: [file: string, caption: string][] = [
  ["01-title", "December 1st. The snow is down and your summer tires are still on."],
  ["02-basilica-notre-dame", "The tire storage is across town, and the shortest way runs through the old city."],
  ["04-metro-mcgill", "Downtown traffic doesn't care that you're in a hurry."],
  ["05-rue-barree-detour", "Rue barrée. The GPS didn't see it coming either, so find another way."],
  ["06-cockpit-arret", "Every arrêt is a choice: stop like a tourist, or roll it and hope nobody's watching."],
  ["07-vieux-montreal-saint-paul", "Cobblestones, tight corners, and someone double-parked right where you need to be."],
  ["08-downtown-rene-levesque", "Running a red on René-Lévesque saves ten seconds, unless the SPVM is behind you."],
  ["10-driving-de-la-commune", "Keep one eye on the road and the other on the mirror."],
  ["11-winter-tire-pickup", "Make it to the storage in one piece and the winter tires are yours."],
  ["12-snow-squall", "Take too long and the squalls roll in. On summer tires."],
];

/**
 * Phone or tablet. The UA catches phones, Android tablets and iPads that say so; an iPad asking for the desktop
 * site claims to be a Mac but has a touchscreen; anything else with no fine pointer at all (no mouse, no
 * trackpad) is a touch device too. A touchscreen laptop still has its trackpad, so it plays.
 * `?mobile` forces this page (to check it on a desktop), `?desktop` skips it.
 */
export function isPhoneOrTablet(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.has("mobile")) return true;
  if (q.has("desktop")) return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (nav.userAgentData?.mobile) return true;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Tablet/i.test(ua)) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return !matchMedia("(any-pointer: fine)").matches && matchMedia("(any-pointer: coarse)").matches;
}

export function showMobileGate(): void {
  document.body.classList.add("mg-body");
  const base = import.meta.env.BASE_URL;
  const page = document.createElement("main");
  page.className = "mg";
  page.innerHTML = `
    <header class="mg-head">
      <h1>MONTREAL<br />DRIVER</h1>
      <p class="mg-tag">J'ai oublié</p>
      <p class="mg-text">
        <em>Montreal Driver: J'ai oublié</em> is a driving game that takes place in Downtown Montreal. It's
        December 1st and you forgot to change to your winter tires: now you have to drive across town to change your
        tires without drawing attention from the SPVM. As any good Montreal driver, you're impatient and prone to
        driving recklessly so this is no easy feat. To make matters more difficult, the roads are full of potholes
        and partially blocked, which makes it pretty difficult to find your way.
      </p>
      <div class="mg-note">
        <span>Desktop only</span>
        <p>The game isn't available on phones or tablets. Come back on a computer with a keyboard or a gamepad.</p>
      </div>
    </header>
    <section class="mg-shots">
      ${SHOTS.map(
        ([file, caption], i) => `
        <figure>
          <img src="${base}screens/${file}.jpg" alt="${caption}" width="1280" height="720"
            ${i > 0 ? 'loading="lazy"' : ""} decoding="async" />
          <figcaption>${caption}</figcaption>
        </figure>`,
      ).join("")}
    </section>
    <footer class="mg-foot">
      <p>Made by Ricardo Magalhães</p>
      <p class="mg-links">
        <a href="https://ricardom.ca" target="_blank" rel="noopener">ricardom.ca</a>
        <span aria-hidden="true">·</span>
        <a href="https://www.instagram.com/magalhini/" target="_blank" rel="noopener">@magalhini</a>
      </p>
    </footer>`;
  document.body.replaceChildren(page);
}
