import { isPhoneOrTablet, showMobileGate } from "./MobileGate";

// Phones and tablets get the screenshots page; only a desktop downloads and starts the game.
if (isPhoneOrTablet()) showMobileGate();
else void import("./main");
