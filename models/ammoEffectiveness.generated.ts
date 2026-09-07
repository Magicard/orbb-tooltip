// GENERATED FILE - do not edit by hand.
// Regenerate after a game patch with: npm run generate:ammo
//
// Source: https://escapefromtarkov.fandom.com/wiki/Ballistics
// Wiki revision 357657, last edited 2026-09-04
//
// What each round does, keyed by BSG item id:
//
//   damage       per projectile
//   projectiles  per shot; buckshot and flechette fire several
//   damageTier   0-6, how the whole shot compares with the hardest-hitting
//                round of the same calibre (6 = the best of them)
//   classes      0-6 against armour classes 1 to 6 on the community
//                effectiveness scale (0 = cannot penetrate in any reasonable
//                number of hits, 6 = penetrates over 80% of the time)

export type AmmoRow = {
  readonly damage: number;
  readonly projectiles: number;
  readonly damageTier: number;
  readonly classes: readonly [number, number, number, number, number, number];
};

export const AMMO_EFFECTIVENESS: Record<string, AmmoRow> = {
  "5fd20ff893a8961fc660a954": { damage: 51, projectiles: 1, damageTier: 2, classes: [6, 6, 6, 6, 5, 4] }, // .300 Blackout AP
  "5fbe3ffdf8b6a877a729ea82": { damage: 60, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 3, 2, 0] }, // .300 Blackout BCP FMJ
  "64b8725c4b75259c590fa899": { damage: 58, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 6, 5, 3] }, // .300 Blackout CBJ
  "619636be6db0f2477964e710": { damage: 54, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 5, 4, 2] }, // .300 Blackout M62 Tracer
  "6196364158ef8c428c287d9f": { damage: 72, projectiles: 1, damageTier: 5, classes: [6, 6, 4, 3, 1, 0] }, // .300 Blackout V-Max
  "6196365d58ef8c428c287da1": { damage: 90, projectiles: 1, damageTier: 6, classes: [6, 4, 2, 1, 0, 0] }, // .300 Whisper
  "67c540c3d0538d12ec036c08": { damage: 80, projectiles: 1, damageTier: 5, classes: [6, 6, 6, 6, 4, 3] }, // .308 ME
  "67c540cfb032bbdb530201b8": { damage: 96, projectiles: 1, damageTier: 6, classes: [6, 6, 3, 2, 0, 0] }, // .308 ME LOKT
  "5fc382a9d724d907e2077dab": { damage: 115, projectiles: 1, damageTier: 2, classes: [6, 6, 6, 6, 6, 6] }, // .338 Lapua Magnum AP
  "5fc275cf85fd526b824a571a": { damage: 122, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 6, 5, 5] }, // .338 Lapua Magnum FMJ
  "5fc382b6d6fa9c00c571bbc3": { damage: 196, projectiles: 1, damageTier: 6, classes: [6, 5, 3, 1, 0, 0] }, // .338 Lapua Magnum TAC-X
  "5fc382c1016cce60e8341b20": { damage: 142, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 5, 4, 2] }, // .338 Lapua Magnum UCW
  "62330b3ed4dc74626d570b95": { damage: 70, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 2, 1, 0] }, // .357 Magnum FMJ
  "62330bfadc5883093563729b": { damage: 99, projectiles: 1, damageTier: 6, classes: [6, 3, 0, 0, 0, 0] }, // .357 Magnum HP
  "62330c18744e5e31df12f516": { damage: 88, projectiles: 1, damageTier: 5, classes: [6, 6, 2, 0, 0, 0] }, // .357 Magnum JHP
  "62330c40bdd19b369e1e53d1": { damage: 108, projectiles: 1, damageTier: 6, classes: [6, 1, 0, 0, 0, 0] }, // .357 Magnum SP
  "5f0596629e22f464da6bbdd9": { damage: 90, projectiles: 1, damageTier: 5, classes: [6, 6, 6, 6, 5, 4] }, // .366 TKM AP-M
  "59e655cb86f77411dc52a77b": { damage: 73, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 3, 1, 0] }, // .366 TKM EKO
  "59e6542b86f77411dc52a77a": { damage: 98, projectiles: 1, damageTier: 5, classes: [6, 6, 4, 1, 0, 0] }, // .366 TKM FMJ
  "59e6658b86f77411d949b250": { damage: 110, projectiles: 1, damageTier: 6, classes: [6, 3, 0, 0, 0, 0] }, // .366 TKM Geksa
  "5efb0cabfb3e451d70735af5": { damage: 66, projectiles: 1, damageTier: 2, classes: [6, 6, 6, 5, 4, 2] }, // .45 ACP AP
  "5efb0fc6aeb21837e749c801": { damage: 100, projectiles: 1, damageTier: 4, classes: [6, 3, 0, 0, 0, 0] }, // .45 ACP Hydra-Shok
  "5efb0d4f4bc50b58e81710f3": { damage: 76, projectiles: 1, damageTier: 2, classes: [6, 5, 1, 0, 0, 0] }, // .45 ACP Lasermatch FMJ
  "5e81f423763d9f754677bf2e": { damage: 72, projectiles: 1, damageTier: 2, classes: [6, 6, 3, 1, 0, 0] }, // .45 ACP Match FMJ
  "5ea2a8e200685063ec28c05a": { damage: 130, projectiles: 1, damageTier: 6, classes: [1, 0, 0, 0, 0, 0] }, // .45 ACP RIP
  "66a0d1e0ed648d72fe064d06": { damage: 94, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 5, 3, 2] }, // .50 AE Copper Solid
  "668fe62ac62660a5d8071446": { damage: 85, projectiles: 1, damageTier: 2, classes: [6, 6, 6, 6, 4, 3] }, // .50 AE FMJ
  "66a0d1f88486c69fce00fdf6": { damage: 122, projectiles: 1, damageTier: 5, classes: [6, 6, 4, 1, 0, 0] }, // .50 AE Hawk JSP
  "66a0d1c87d0d369e270bb9de": { damage: 147, projectiles: 1, damageTier: 6, classes: [6, 1, 0, 0, 0, 0] }, // .50 AE JHP
  "67d41936f378a36c4706eeb9": { damage: 260, projectiles: 1, damageTier: 6, classes: [6, 6, 6, 4, 3, 1] }, // .50 BMG HP
  "67dc212493ce32834b0fa446": { damage: 220, projectiles: 1, damageTier: 5, classes: [6, 6, 6, 6, 5, 4] }, // .50 BMG M21
  "67dc255ee3028a8b120efc48": { damage: 190, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 6, 6, 5] }, // .50 BMG M33
  "67dc2648ba5b79876906a166": { damage: 160, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 6, 6, 6] }, // .50 BMG M903 SLAP
  "5cadf6ddae9215051e1c23b2": { damage: 115, projectiles: 1, damageTier: 3, classes: [6, 6, 5, 2, 1, 0] }, // 12.7x55mm PS12
  "5cadf6e5ae921500113bb973": { damage: 165, projectiles: 1, damageTier: 6, classes: [6, 0, 0, 0, 0, 0] }, // 12.7x55mm PS12A
  "5cadf6eeae921500134b2799": { damage: 102, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 6, 5, 4] }, // 12.7x55mm PS12B
  "5d6e6772a4b936088465b17c": { damage: 37, projectiles: 8, damageTier: 4, classes: [3, 3, 3, 3, 3, 3] }, // 12/70 5.25mm buckshot
  "5d6e67fba4b9361bc73bc779": { damage: 35, projectiles: 9, damageTier: 4, classes: [3, 3, 3, 3, 3, 3] }, // 12/70 6.5mm Express buckshot
  "560d5e524bdc2d25448b4571": { damage: 39, projectiles: 8, damageTier: 4, classes: [3, 3, 3, 3, 3, 3] }, // 12/70 7mm buckshot
  "5d6e6806a4b936088465b17e": { damage: 50, projectiles: 8, damageTier: 6, classes: [3, 3, 3, 3, 3, 3] }, // 12/70 8.5mm Magnum buckshot
  "5d6e68a8a4b9360b6c0d54e2": { damage: 164, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 5, 4, 3] }, // 12/70 AP-20 armor-piercing slug
  "5d6e68b3a4b9361bca7e50b5": { damage: 206, projectiles: 1, damageTier: 4, classes: [6, 3, 1, 0, 0, 0] }, // 12/70 Copper Sabot Premier HP slug
  "5d6e68dea4b9361bcc29e659": { damage: 85, projectiles: 2, damageTier: 3, classes: [6, 5, 2, 0, 0, 0] }, // 12/70 Dual Sabot slug
  "5d6e6911a4b9361bd5780d52": { damage: 25, projectiles: 8, damageTier: 2, classes: [6, 6, 6, 5, 5, 5] }, // 12/70 flechette
  "5d6e68e6a4b9361c140bcfe0": { damage: 183, projectiles: 1, damageTier: 3, classes: [6, 6, 2, 0, 0, 0] }, // 12/70 FTX Custom Lite slug
  "5d6e6869a4b9361c140bcfde": { damage: 190, projectiles: 1, damageTier: 4, classes: [6, 2, 0, 0, 0, 0] }, // 12/70 Grizzly 40 slug
  "58820d1224597753c90aeb13": { damage: 167, projectiles: 1, damageTier: 3, classes: [6, 4, 1, 0, 0, 0] }, // 12/70 lead slug
  "5d6e68c4a4b9361b93413f79": { damage: 197, projectiles: 1, damageTier: 4, classes: [6, 6, 5, 3, 1, 0] }, // 12/70 makeshift .50 BMG slug
  "64b8ee384b75259c590fa89b": { damage: 25, projectiles: 10, damageTier: 3, classes: [6, 6, 5, 4, 4, 4] }, // 12/70 Piranha
  "5d6e6891a4b9361bd473feea": { damage: 140, projectiles: 1, damageTier: 2, classes: [6, 5, 1, 0, 0, 0] }, // 12/70 Poleva-3 slug
  "5d6e689ca4b9361bc8618956": { damage: 150, projectiles: 1, damageTier: 2, classes: [6, 6, 2, 0, 0, 0] }, // 12/70 Poleva-6u slug
  "5c0d591486f7744c505b416f": { damage: 265, projectiles: 1, damageTier: 6, classes: [0, 0, 0, 0, 0, 0] }, // 12/70 RIP
  "5d6e68d1a4b93622fe60e845": { damage: 220, projectiles: 1, damageTier: 5, classes: [0, 0, 0, 0, 0, 0] }, // 12/70 SuperFormance HP slug
  "5d6e695fa4b936359b35d852": { damage: 26, projectiles: 8, damageTier: 6, classes: [3, 3, 3, 3, 3, 3] }, // 20/70 5.6mm buckshot
  "5d6e69b9a4b9361bc8618958": { damage: 22, projectiles: 8, damageTier: 5, classes: [3, 3, 3, 3, 3, 3] }, // 20/70 6.2mm buckshot
  "5d6e69c7a4b9360b6c0d54e4": { damage: 23, projectiles: 9, damageTier: 6, classes: [3, 3, 3, 3, 3, 3] }, // 20/70 7.3mm buckshot
  "5a38ebd9c4a282000d722a5b": { damage: 25, projectiles: 8, damageTier: 6, classes: [3, 3, 3, 3, 3, 3] }, // 20/70 7.5mm buckshot
  "660137ef76c1b56143052be8": { damage: 143, projectiles: 1, damageTier: 4, classes: [6, 6, 5, 3, 1, 0] }, // 20/70 Dangerous Game Slug
  "5d6e6a5fa4b93614ec501745": { damage: 198, projectiles: 1, damageTier: 6, classes: [1, 0, 0, 0, 0, 0] }, // 20/70 Devastator slug
  "6601380580e77cfd080e3418": { damage: 20, projectiles: 8, damageTier: 4, classes: [6, 6, 5, 4, 4, 4] }, // 20/70 flechette
  "5d6e6a53a4b9361bd473feec": { damage: 120, projectiles: 1, damageTier: 3, classes: [6, 2, 0, 0, 0, 0] }, // 20/70 Poleva-3 slug
  "5d6e6a42a4b9364f07165f52": { damage: 135, projectiles: 1, damageTier: 3, classes: [6, 5, 1, 0, 0, 0] }, // 20/70 Poleva-6u slug
  "5d6e6a05a4b93618084f58d0": { damage: 154, projectiles: 1, damageTier: 4, classes: [6, 5, 1, 0, 0, 0] }, // 20/70 Star slug
  "660137d8481cc6907a0c5cda": { damage: 155, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 3, 1, 0] }, // 20/70 TSS Armor Piercing Slug
  "6601546f86889319850bd566": { damage: 1, projectiles: 1, damageTier: 6, classes: [0, 0, 0, 0, 0, 0] }, // 20x1mm disk
  "5e85aa1a988a8701445df1f5": { damage: 192, projectiles: 1, damageTier: 6, classes: [6, 6, 6, 6, 4, 4] }, // 23x75mm Barrikada slug
  "5e85a9a6eacf8c039e4e2ac1": { damage: 87, projectiles: 8, damageTier: 6, classes: [6, 4, 3, 3, 3, 3] }, // 23x75mm Shrapnel-10 buckshot
  "5f647f31b6238e5dd066e196": { damage: 78, projectiles: 8, damageTier: 5, classes: [6, 4, 3, 3, 3, 3] }, // 23x75mm Shrapnel-25 buckshot
  "5e85a9f4add9fe03027d9bf1": { damage: 0, projectiles: 1, damageTier: 0, classes: [0, 0, 0, 0, 0, 0] }, // 23x75mm Zvezda flashbang round
  "5ba26812d4351e003201fef1": { damage: 65, projectiles: 1, damageTier: 6, classes: [6, 5, 1, 0, 0, 0] }, // 4.6x30mm Action SX
  "5ba26835d4351e0035628ff5": { damage: 35, projectiles: 1, damageTier: 2, classes: [6, 6, 6, 6, 6, 5] }, // 4.6x30mm AP SX
  "5ba2678ad4351e44f824b344": { damage: 43, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 6, 4, 3] }, // 4.6x30mm FMJ SX
  "64b6979341772715af0f9c39": { damage: 46, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 4, 2, 1] }, // 4.6x30mm JSP SX
  "5ba26844d4351e00334c9475": { damage: 52, projectiles: 1, damageTier: 5, classes: [6, 6, 3, 0, 0, 0] }, // 4.6x30mm Subsonic SX
  "5ede475339ee016e8c534742": { damage: 160, projectiles: 15, damageTier: 6, classes: [5, 3, 3, 3, 3, 3] }, // 40x46mm M576 (MP-APERS) grenade
  "61962b617c6c7b169525f168": { damage: 55, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 6, 4, 3] }, // 5.45x39mm 7N40
  "56dfef82d2720bbd668b4567": { damage: 48, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 6, 5, 4] }, // 5.45x39mm BP gs
  "56dff026d2720bb8668b4567": { damage: 45, projectiles: 1, damageTier: 2, classes: [6, 6, 6, 6, 6, 5] }, // 5.45x39mm BS gs
  "56dff061d2720bb5668b4567": { damage: 54, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 5, 3, 2] }, // 5.45x39mm BT gs
  "56dff0bed2720bb0668b4567": { damage: 55, projectiles: 1, damageTier: 4, classes: [6, 6, 3, 2, 0, 0] }, // 5.45x39mm FMJ
  "56dff216d2720bbd668b4568": { damage: 76, projectiles: 1, damageTier: 6, classes: [5, 0, 0, 0, 0, 0] }, // 5.45x39mm HP
  "56dff2ced2720bb4668b4567": { damage: 51, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 4, 3, 1] }, // 5.45x39mm PP gs
  "5c0d5e4486f77478390952fe": { damage: 37, projectiles: 1, damageTier: 1, classes: [6, 6, 6, 6, 6, 6] }, // 5.45x39mm PPBS gs Igolnik
  "56dff338d2720bbd668b4569": { damage: 70, projectiles: 1, damageTier: 6, classes: [6, 1, 0, 0, 0, 0] }, // 5.45x39mm PRS gs
  "56dff3afd2720bba668b4567": { damage: 56, projectiles: 1, damageTier: 4, classes: [6, 6, 5, 3, 1, 0] }, // 5.45x39mm PS gs
  "56dff421d2720b5f5a8b4567": { damage: 67, projectiles: 1, damageTier: 5, classes: [6, 2, 0, 0, 0, 0] }, // 5.45x39mm SP
  "56dff4a2d2720bbd668b456a": { damage: 59, projectiles: 1, damageTier: 4, classes: [6, 6, 1, 0, 0, 0] }, // 5.45x39mm T gs
  "56dff4ecd2720b5f5a8b4568": { damage: 65, projectiles: 1, damageTier: 5, classes: [6, 5, 1, 0, 0, 0] }, // 5.45x39mm US gs
  "59e6920f86f77411d82aa167": { damage: 57, projectiles: 1, damageTier: 3, classes: [6, 6, 4, 1, 0, 0] }, // 5.56x45mm FMJ
  "59e6927d86f77411da468256": { damage: 79, projectiles: 1, damageTier: 5, classes: [4, 0, 0, 0, 0, 0] }, // 5.56x45mm HP
  "54527a984bdc2d4e668b4567": { damage: 54, projectiles: 1, damageTier: 3, classes: [6, 6, 5, 3, 2, 0] }, // 5.56x45mm M855
  "54527ac44bdc2d36668b4567": { damage: 49, projectiles: 1, damageTier: 2, classes: [6, 6, 6, 6, 5, 4] }, // 5.56x45mm M855A1
  "59e68f6f86f7746c9f75e846": { damage: 60, projectiles: 1, damageTier: 3, classes: [6, 5, 1, 0, 0, 0] }, // 5.56x45mm M856
  "59e6906286f7746c9f75e847": { damage: 52, projectiles: 1, damageTier: 2, classes: [6, 6, 6, 5, 3, 2] }, // 5.56x45mm M856A1
  "59e690b686f7746c9f75e848": { damage: 42, projectiles: 1, damageTier: 1, classes: [6, 6, 6, 6, 6, 5] }, // 5.56x45mm M995
  "59e6918f86f7746c9f75e849": { damage: 72, projectiles: 1, damageTier: 5, classes: [6, 1, 0, 0, 0, 0] }, // 5.56x45mm MK 255 Mod 0 (RRLP)
  "60194943740c5d77f6705eea": { damage: 53, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 4, 2, 1] }, // 5.56x45mm MK 318 Mod 0 (SOST)
  "601949593ae8f707c4608daa": { damage: 38, projectiles: 1, damageTier: 1, classes: [6, 6, 6, 6, 6, 5] }, // 5.56x45mm SSA AP
  "5c0d5ae286f7741e46554302": { damage: 88, projectiles: 1, damageTier: 6, classes: [1, 0, 0, 0, 0, 0] }, // 5.56x45mm Warmageddon
  "5cc80f53e4a949000e1ea4f8": { damage: 53, projectiles: 1, damageTier: 2, classes: [6, 6, 6, 3, 2, 2] }, // 5.7x28mm L191
  "5cc86832d7f00c000d3a6e6c": { damage: 98, projectiles: 1, damageTier: 6, classes: [4, 0, 0, 0, 0, 0] }, // 5.7x28mm R37.F
  "5cc86840d7f00c002412c56c": { damage: 81, projectiles: 1, damageTier: 5, classes: [6, 1, 0, 0, 0, 0] }, // 5.7x28mm R37.X
  "5cc80f67e4a949035e43bbba": { damage: 59, projectiles: 1, damageTier: 3, classes: [6, 6, 5, 2, 1, 0] }, // 5.7x28mm SB193
  "5cc80f38e4a949001152b560": { damage: 49, projectiles: 1, damageTier: 2, classes: [6, 6, 6, 5, 4, 3] }, // 5.7x28mm SS190
  "5cc80f8fe4a949033b0224a2": { damage: 62, projectiles: 1, damageTier: 3, classes: [6, 6, 4, 1, 0, 0] }, // 5.7x28mm SS197SR
  "5cc80f79e4a949033c7343b2": { damage: 70, projectiles: 1, damageTier: 4, classes: [6, 4, 1, 0, 0, 0] }, // 5.7x28mm SS198LF
  "6a07208057b2695f9d001e63": { damage: 53, projectiles: 1, damageTier: 6, classes: [6, 6, 6, 5, 3, 2] }, // 5.8x42mm DBP191
  "6a42661705016139300b2085": { damage: 57, projectiles: 1, damageTier: 6, classes: [6, 6, 6, 4, 2, 1] }, // 5.8x42mm DBX95
  "6a42662fcb506840dd053827": { damage: 46, projectiles: 1, damageTier: 5, classes: [6, 6, 6, 6, 6, 5] }, // 5.8x42mm DVC12
  "6a426637ddc63098d100ae67": { damage: 48, projectiles: 1, damageTier: 5, classes: [6, 6, 6, 6, 5, 5] }, // 5.8x42mm DVX12
  "6529302b8c26af6326029fb7": { damage: 80, projectiles: 1, damageTier: 6, classes: [6, 6, 6, 5, 4, 2] }, // 6.8x51mm SIG FMJ
  "6529243824cbe3c74a05e5c1": { damage: 72, projectiles: 1, damageTier: 6, classes: [6, 6, 6, 6, 5, 5] }, // 6.8x51mm SIG Hybrid
  "5735fdcd2459776445391d61": { damage: 58, projectiles: 1, damageTier: 5, classes: [6, 2, 0, 0, 0, 0] }, // 7.62x25mm TT AKBS
  "5735ff5c245977640e39ba7e": { damage: 60, projectiles: 1, damageTier: 6, classes: [6, 1, 0, 0, 0, 0] }, // 7.62x25mm TT FMJ43
  "573601b42459776410737435": { damage: 64, projectiles: 1, damageTier: 6, classes: [5, 0, 0, 0, 0, 0] }, // 7.62x25mm TT LRN
  "573602322459776445391df1": { damage: 66, projectiles: 1, damageTier: 6, classes: [5, 0, 0, 0, 0, 0] }, // 7.62x25mm TT LRNPC
  "68c15a033173b556890b5959": { damage: 34, projectiles: 1, damageTier: 2, classes: [6, 6, 5, 3, 2, 0] }, // 7.62x25mm TT M855A1
  "68c15b4bb30038a118088bd6": { damage: 36, projectiles: 1, damageTier: 2, classes: [6, 6, 5, 3, 1, 0] }, // 7.62x25mm TT M856A1
  "68c15f77ed3d7df9220debd6": { damage: 32, projectiles: 1, damageTier: 1, classes: [6, 6, 6, 5, 4, 3] }, // 7.62x25mm TT M995
  "5736026a245977644601dc61": { damage: 58, projectiles: 1, damageTier: 5, classes: [6, 3, 0, 0, 0, 0] }, // 7.62x25mm TT P gl
  "573603562459776430731618": { damage: 50, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 4, 1, 0] }, // 7.62x25mm TT Pst gzh
  "573603c924597764442bd9cb": { damage: 55, projectiles: 1, damageTier: 5, classes: [6, 4, 0, 0, 0, 0] }, // 7.62x25mm TT PT gzh
  "59e0d99486f7744a32234762": { damage: 58, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 6, 5, 4] }, // 7.62x39mm BP gzh
  "64b7af5a8532cf95ee0a0dbd": { damage: 63, projectiles: 1, damageTier: 4, classes: [6, 6, 4, 1, 0, 0] }, // 7.62x39mm FMJ
  "59e4d3d286f774176a36250a": { damage: 80, projectiles: 1, damageTier: 6, classes: [6, 4, 1, 0, 0, 0] }, // 7.62x39mm HP
  "601aa3d2b2bcb34913271e6d": { damage: 53, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 6, 6, 5] }, // 7.62x39mm MAI AP
  "64b7af434b75259c590fa893": { damage: 59, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 6, 4, 3] }, // 7.62x39mm PP gzh
  "5656d7c34bdc2d9d198b4587": { damage: 61, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 5, 3, 2] }, // 7.62x39mm PS gzh
  "64b7af734b75259c590fa895": { damage: 68, projectiles: 1, damageTier: 5, classes: [6, 6, 2, 0, 0, 0] }, // 7.62x39mm SP
  "59e4cf5286f7741778269d8a": { damage: 65, projectiles: 1, damageTier: 5, classes: [6, 6, 6, 3, 1, 0] }, // 7.62x39mm T-45M1 gzh
  "59e4d24686f7741776641ac7": { damage: 56, projectiles: 1, damageTier: 4, classes: [6, 6, 5, 3, 1, 0] }, // 7.62x39mm US gzh
  "5e023e53d4353e3302577c4c": { damage: 83, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 5, 4, 2] }, // 7.62x51mm BCP FMJ
  "5a6086ea4f39f99cd479502f": { damage: 73, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 6, 6, 6] }, // 7.62x51mm M61
  "5a608bf24f39f98ffc77720e": { damage: 82, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 6, 5, 4] }, // 7.62x51mm M62 Tracer
  "58dd3ad986f77403051cba8f": { damage: 80, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 6, 5, 5] }, // 7.62x51mm M80
  "6768c25aa7b238f14a08d3f6": { damage: 75, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 6, 6, 5] }, // 7.62x51mm M80A1
  "5efb0c1bd79ff02a1f5e68d9": { damage: 70, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 6, 6, 6] }, // 7.62x51mm M993
  "5e023e6e34d52a55c3304f71": { damage: 85, projectiles: 1, damageTier: 5, classes: [6, 6, 6, 3, 2, 0] }, // 7.62x51mm TCW SP
  "5e023e88277cce2b522ff2b1": { damage: 105, projectiles: 1, damageTier: 6, classes: [6, 4, 0, 0, 0, 0] }, // 7.62x51mm Ultra Nosler
  "5e023d48186a883be655e551": { damage: 72, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 6, 6, 6] }, // 7.62x54mm R BS gs
  "5e023d34e8a400319a28ed44": { damage: 78, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 6, 6, 5] }, // 7.62x54mm R BT gzh
  "64b8f7968532cf95ee0a0dbf": { damage: 84, projectiles: 1, damageTier: 5, classes: [6, 6, 6, 5, 3, 2] }, // 7.62x54mm R FMJ
  "64b8f7c241772715af0f9c3d": { damage: 102, projectiles: 1, damageTier: 6, classes: [6, 6, 3, 1, 0, 0] }, // 7.62x54mm R HP BT
  "5887431f2459777e1612938f": { damage: 81, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 6, 4, 3] }, // 7.62x54mm R LPS gzh
  "59e77a2386f7742ee578960a": { damage: 84, projectiles: 1, damageTier: 5, classes: [6, 6, 6, 6, 5, 5] }, // 7.62x54mm R PS gzh
  "560d61e84bdc2da74d8b4571": { damage: 75, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 6, 6, 6] }, // 7.62x54mm R SNB gzh
  "64b8f7b5389d7ffd620ccba2": { damage: 92, projectiles: 1, damageTier: 6, classes: [6, 6, 5, 4, 2, 1] }, // 7.62x54mm R SP BT
  "5e023cf8186a883be655e54f": { damage: 82, projectiles: 1, damageTier: 5, classes: [6, 6, 6, 6, 4, 3] }, // 7.62x54mm R T-46M gzh
  "68bad8376cb22acf1107a586": { damage: 108, projectiles: 1, damageTier: 5, classes: [6, 6, 6, 6, 5, 5] }, // 9.3x64mm 7N33
  "68bac6ca653ee6b1e406d978": { damage: 115, projectiles: 1, damageTier: 5, classes: [6, 6, 6, 6, 5, 4] }, // 9.3x64mm FMJ
  "68aeed8a8906b00bc800fdd6": { damage: 129, projectiles: 1, damageTier: 6, classes: [6, 6, 6, 4, 3, 2] }, // 9.3x64mm SP
  "573718ba2459775a75491131": { damage: 53, projectiles: 1, damageTier: 3, classes: [6, 5, 1, 0, 0, 0] }, // 9x18mm PM BZhT gzh
  "573719762459775a626ccbc1": { damage: 50, projectiles: 1, damageTier: 3, classes: [2, 0, 0, 0, 0, 0] }, // 9x18mm PM P gzh
  "573719df2459775a626ccbc2": { damage: 40, projectiles: 1, damageTier: 2, classes: [6, 6, 5, 1, 0, 0] }, // 9x18mm PM PBM gzh
  "57371b192459775a9f58a5e0": { damage: 61, projectiles: 1, damageTier: 4, classes: [4, 0, 0, 0, 0, 0] }, // 9x18mm PM PPe gzh
  "57371e4124597760ff7b25f1": { damage: 59, projectiles: 1, damageTier: 4, classes: [5, 1, 0, 0, 0, 0] }, // 9x18mm PM PPT gzh
  "57371eb62459776125652ac1": { damage: 58, projectiles: 1, damageTier: 4, classes: [3, 0, 0, 0, 0, 0] }, // 9x18mm PM PRS gs
  "57371f2b24597761224311f1": { damage: 55, projectiles: 1, damageTier: 4, classes: [3, 0, 0, 0, 0, 0] }, // 9x18mm PM PS gs PPO
  "57371f8d24597761006c6a81": { damage: 54, projectiles: 1, damageTier: 4, classes: [2, 0, 0, 0, 0, 0] }, // 9x18mm PM PSO gzh
  "5737201124597760fc4431f1": { damage: 50, projectiles: 1, damageTier: 3, classes: [6, 1, 0, 0, 0, 0] }, // 9x18mm PM Pst gzh
  "5737207f24597760ff7b25f2": { damage: 69, projectiles: 1, damageTier: 5, classes: [0, 0, 0, 0, 0, 0] }, // 9x18mm PM PSV
  "573720e02459776143012541": { damage: 65, projectiles: 1, damageTier: 5, classes: [6, 2, 0, 0, 0, 0] }, // 9x18mm PM RG028 gzh
  "57372140245977611f70ee91": { damage: 77, projectiles: 1, damageTier: 6, classes: [0, 0, 0, 0, 0, 0] }, // 9x18mm PM SP7 gzh
  "5737218f245977612125ba51": { damage: 67, projectiles: 1, damageTier: 5, classes: [0, 0, 0, 0, 0, 0] }, // 9x18mm PM SP8 gzh
  "57371aab2459775a77142f22": { damage: 58, projectiles: 1, damageTier: 4, classes: [6, 6, 4, 0, 0, 0] }, // 9x18mm PMM PstM gzh
  "5c925fa22e221601da359b7b": { damage: 52, projectiles: 1, damageTier: 2, classes: [6, 6, 6, 4, 2, 1] }, // 9x19mm AP 6.3
  "64b7bbb74b75259c590fa897": { damage: 56, projectiles: 1, damageTier: 2, classes: [6, 5, 2, 0, 0, 0] }, // 9x19mm FMJ M882
  "5c3df7d588a4501f290594e5": { damage: 58, projectiles: 1, damageTier: 2, classes: [6, 3, 1, 0, 0, 0] }, // 9x19mm Green Tracer
  "5a3c16fe86f77452b62de32a": { damage: 70, projectiles: 1, damageTier: 3, classes: [6, 2, 0, 0, 0, 0] }, // 9x19mm Luger CCI
  "5efb0da7a29a85116f6ea05f": { damage: 44, projectiles: 1, damageTier: 1, classes: [6, 6, 6, 5, 4, 3] }, // 9x19mm PBP gzh
  "58864a4f2459770fcc257101": { damage: 59, projectiles: 1, damageTier: 2, classes: [6, 2, 0, 0, 0, 0] }, // 9x19mm PSO gzh
  "56d59d3ad2720bdb418b4577": { damage: 54, projectiles: 1, damageTier: 2, classes: [6, 6, 2, 0, 0, 0] }, // 9x19mm Pst gzh
  "5efb0e16aeb21837e749c7ff": { damage: 85, projectiles: 1, damageTier: 5, classes: [6, 1, 0, 0, 0, 0] }, // 9x19mm QuakeMaker
  "5c0d56a986f774449d5de529": { damage: 102, projectiles: 1, damageTier: 6, classes: [0, 0, 0, 0, 0, 0] }, // 9x19mm RIP
  "6576f4708ca9c4381d16cd9d": { damage: 49, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 5, 4, 2] }, // 9x21mm 7N42 Zubilo
  "6576f93989f0062e741ba952": { damage: 53, projectiles: 1, damageTier: 3, classes: [6, 6, 5, 3, 1, 0] }, // 9x21mm 7U4
  "5a26ac0ec4a28200741e1e18": { damage: 52, projectiles: 1, damageTier: 3, classes: [6, 6, 6, 4, 3, 1] }, // 9x21mm BT gzh
  "5a26abfac4a28232980eabff": { damage: 65, projectiles: 1, damageTier: 5, classes: [6, 3, 0, 0, 0, 0] }, // 9x21mm P gzh
  "5a26ac06c4a282000c5a90a8": { damage: 80, projectiles: 1, damageTier: 6, classes: [6, 2, 0, 0, 0, 0] }, // 9x21mm PE gzh
  "5a269f97c4a282000b151807": { damage: 59, projectiles: 1, damageTier: 4, classes: [6, 6, 3, 1, 0, 0] }, // 9x21mm PS gzh
  "5c0d688c86f77413ae3407b2": { damage: 58, projectiles: 1, damageTier: 4, classes: [6, 6, 6, 6, 6, 5] }, // 9x39mm BP gs
  "6576f96220d53a5b8f3e395e": { damage: 75, projectiles: 1, damageTier: 6, classes: [6, 5, 2, 0, 0, 0] }, // 9x39mm FMJ
  "61962d879bb3d20b0946d385": { damage: 62, projectiles: 1, damageTier: 5, classes: [6, 6, 6, 6, 5, 4] }, // 9x39mm PAB-9 gs
  "57a0dfb82459774d3078b56c": { damage: 71, projectiles: 1, damageTier: 6, classes: [6, 6, 5, 2, 1, 0] }, // 9x39mm SP-5 gs
  "57a0e5022459774d1673f889": { damage: 60, projectiles: 1, damageTier: 5, classes: [6, 6, 6, 6, 5, 5] }, // 9x39mm SP-6 gs
  "5c0d668f86f7747ccb7f13b2": { damage: 68, projectiles: 1, damageTier: 6, classes: [6, 6, 6, 5, 3, 2] }, // 9x39mm SPP gs
};
