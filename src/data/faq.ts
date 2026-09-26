export type Faq = { q: string; a: string; home?: boolean };

/** Answers stay honest and non-committal where Alvaro hasn't set a policy (e.g. warranty terms). */
export const faqs: Faq[] = [
  {
    q: "Is modding safe for my console?",
    a: "Every install gets clean soldering, careful board handling, strain relief on wires and a full test before it goes back to you. Advanced rework always carries a small risk. I'll tell you upfront if I see anything concerning, like prior damage or a failed install.",
    home: true,
  },
  {
    q: "Can I still play online?",
    a: "Connecting a modified console to official online services always carries a ban risk. On Switch I set up emuMMC, so your modded setup is kept separate from your stock system, and I'll walk you through how to use it safely. Ask me about your specific setup.",
    home: true,
  },
  {
    q: "How long does it take?",
    a: "Local drop-offs in the Seattle area are usually done the same or next day. Repairs and custom work depend on parts, and you'll get a time estimate with your quote.",
    home: true,
  },
  {
    q: "Do you do mail-in?",
    a: "Yes. Send a request, pick \"Mail-in\", and we'll work out shipping, packing and timing together before you send anything.",
    home: true,
  },
  {
    q: "Will I lose my saves or data?",
    a: "Storage isn't wiped for typical mod installs unless you ask me to. Still, back up anything important before handing your console over, just in case.",
  },
  {
    q: "What do I need to bring?",
    a: "The console and its power supply or charger. For Switch mods, bring a microSD card too: 128GB works, but I recommend 256GB or more. Buy it from a reputable seller, because there are a lot of fake SD cards out there that report the wrong size and corrupt your data. For repairs, bring the device plus a note on what happened right before the issue started.",
    home: true,
  },
  {
    q: "Is there a warranty?",
    a: "Workmanship coverage is confirmed with your completed job. Ask me before booking if you want the details. Physical damage or changes made by others after pickup aren't covered.",
  },
  {
    q: "Can you do something that's not listed?",
    a: "Probably! Port and joystick replacements, custom shells, RGB lighting, board repair and one-off builds are all fair game. Send a quote request with photos and I'll let you know.",
  },
  {
    q: "I'm new to this. Is that okay?",
    a: "Absolutely. The whole process is noob-friendly. Ask anything, I'll keep you updated on progress, and you'll get a walkthrough of your setup at pickup.",
  },
];
