export const creatorPipelineStyles = `
html, body { margin: 0; background: transparent; }
.riff-pipeline { min-width: 0; color: #242426; font-family: var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
.riff-pipeline__chrome { display:flex;width:100%;flex:0 0 auto;align-items:center;justify-content:space-between;padding:16px 24px 8px;border-radius:24px 24px 0 0; }
.riff-pipeline__chrome[hidden] { display:none; }
.riff-pipeline__chrome-trail { display:flex;width:fit-content;height:44px;flex:0 0 auto;align-items:center;gap:14px;white-space:nowrap; }
.riff-pipeline__brand { display:flex;flex:0 0 auto;align-items:center;gap:8px;color:#242426;font-size:14px;font-weight:600;line-height:20px;overflow-wrap:normal;white-space:nowrap; }
.riff-pipeline__brand svg, .riff-pipeline__brand > span { flex:0 0 auto; }
.riff-app .riff-pipeline__brand .riff-logo { width:22px;height:22px; }
.riff-pipeline__separator { color:#ABB0B9;font-size:14px;line-height:20px; }
.riff-pipeline__location { color:#242426;font-size:13px;line-height:20px; }
.riff-pipeline__surface { min-width: 0; overflow: hidden; background: #fff; }
.riff-pipeline[data-mode="inline"] .riff-pipeline__surface { padding: 0; border: 0; border-radius: 0; background: transparent; }
.riff-pipeline[data-mode="fullscreen"] { min-height: 100dvh; padding:12px;background:radial-gradient(circle,rgba(101,86,122,.06) .6px,transparent .85px) center/16px 16px,radial-gradient(at 10% 70%,#DCEBFA 0%,transparent 60%),radial-gradient(at 70% 65%,#E6DDF6 0%,transparent 58%),radial-gradient(at 92% 30%,#F5E2EF 0%,transparent 55%),#FCFCFE; }
.riff-pipeline[data-mode="fullscreen"] .riff-pipeline__surface { width: min(100%, 1055px); min-height: calc(100dvh - 92px); margin: 0 auto; background: transparent; }
.riff-pipeline[data-mode="fullscreen"][data-embedded="true"] { min-height:calc(100dvh - 92px);padding:0;background:transparent; }
.riff-pipeline[data-mode="fullscreen"][data-embedded="true"] .riff-pipeline__surface { min-height:calc(100dvh - 92px); }
.riff-pipeline[data-mode="inline"] .riff-pipeline__chrome { display:none; }
.riff-pipeline__content { position: relative; z-index: 1; }
.riff-pipeline__status { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.riff-pipeline__status[data-menu-feedback="true"] { position:relative;width:min(100% - 32px,640px);height:auto;margin:16px auto;padding:12px 14px;overflow:visible;clip:auto;white-space:normal;border:1px solid var(--color-border-secondary,#E3E7EE);border-radius:12px;color:var(--color-text-primary,#242426);background:var(--color-background-primary,#FFF);font-size:14px;line-height:20px; }
.riff-paper-screen { display: flex; flex-direction: column; width: 100%; min-height: 100%; overflow: hidden; background: #fff; }
.riff-paper--analysis, .riff-paper--profile { gap: 24px; padding: 28px 44px 32px; border-radius: 0 0 24px 24px; }
.riff-paper--analysis::before, .riff-paper--profile::before, .riff-paper--studio::before {
  position: absolute; inset: 0; z-index: -1; background: radial-gradient(circle, rgba(203, 213, 225, .314) .8px, transparent .9px) 12px 12px / 24px 24px; content: "";
}
.riff-paper--discovery { gap: 16px; padding: 28px 28px 32px; border-radius: 0 0 24px 24px; }
.riff-paper--studio { gap: 20px; padding: 24px 28px 32px; border-radius: 0 0 24px 24px; }
.riff-paper--pending { align-items: flex-start; padding: 0; background: transparent; }
.riff-paper--failure { align-items: flex-start; padding: 0; background: transparent; }
.riff-paper--partial-analysis { align-items: flex-start; padding: 0; background: transparent; }
.riff-inline-result { display: flex; flex-direction: column; gap: 20px; padding: 20px; border: 1px solid #e5e5e7; border-radius: 18px; background: #fff; }
.riff-title h1 { color: #202124; font-size: 24px; font-weight: 700; line-height: 30px; letter-spacing: -.025em; text-wrap: balance; }
.riff-paper--profile .riff-title h1 { font-weight: 600; }
.riff-inline-result .riff-title h1 { font-size: clamp(24px, 7cqi, 34px); line-height: 1.06; }
.riff-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.riff-button, .riff-library, .riff-filter, .riff-studio-tab, .riff-carousel-arrow, .riff-discovery-dot, .riff-bookmark {
  appearance: none; min-height: 44px; border: 1px solid #e5e5e7; color: #242426; background: #fff; cursor: pointer;
}
.riff-button { display: inline-flex; align-items: center; justify-content: center; padding: 10px 18px; border-radius: 999px; color: #6933a1; font-size: 14px; font-weight: 600; line-height: 20px; box-shadow: 0 1px 2px #18243a0a, 0 4px 10px #18243a08; }
.riff-button--primary { color: #fff; border-color: #A786E9; background: radial-gradient(circle farthest-corner at 50% 45% in oklab,oklab(46.1% .087 -.206) 0%,oklab(50.7% .09 -.203) 55%,oklab(61.7% .089 -.17) 100%),#7138D4; box-shadow: inset 0 1px 2px #FFFFFF55,0 4px 8px #54259B33,0 10px 20px #7444CD33; }
.riff-button:hover, .riff-library:hover, .riff-filter:hover, .riff-studio-tab:hover, .riff-carousel-arrow:hover, .riff-bookmark:hover { filter: brightness(.985); }
.riff-button:active, .riff-library:active, .riff-filter:active, .riff-studio-tab:active, .riff-carousel-arrow:active, .riff-bookmark:active { transform: translateY(1px); }
.riff-loading-card { display: flex; width: 540px; max-width: 100%; flex-direction: column; gap: 18px; padding: 22px; border-radius: 20px; background: radial-gradient(circle,rgba(101,86,122,.06) .6px,transparent .85px) center/16px 16px,radial-gradient(at 10% 70%,#DCEBFA 0%,transparent 60%),radial-gradient(at 70% 65%,#E6DDF6 0%,transparent 58%),radial-gradient(at 92% 30%,#F5E2EF 0%,transparent 55%),#FCFCFE; box-shadow: 0 3px 6px #2035560a, 0 12px 24px #20355614; }
.riff-loading-intro { display: flex; flex-direction: column; gap: 6px; }
.riff-loading-intro h1 { color: #242426; font-size: 20px; font-weight: 600; line-height: 26px; }
.riff-loading-intro p { color: #596273; font-size: 13px; line-height: 19px; }
.riff-loading-video { display: flex; align-items: center; gap: 14px; width: 100%; height:102px; padding: 12px; border-radius: 14px; background: #f0f3f7; }
.riff-loading-video__media { flex: 0 0 52px; width: 52px; height: 78px; border: 2px solid #fff; border-radius: 10px; background: linear-gradient(155deg, #dfe6f1, #bdc9d9); box-shadow: 0 4px 9px #20355618; }
.riff-loading-video__copy { display: flex; flex-direction: column; gap: 6px; }
.riff-loading-video__copy strong { color: #242426; font-size: 13px; font-weight: 500; line-height: 19px; }
.riff-loading-video__copy span { color: #596273; font-size: 13px; line-height: 19px; }
.riff-loading-references { display: flex; flex-shrink: 0; gap: 9px; width: 100%; height: 110px; padding: 10px 8px; overflow: hidden; border-radius: 14px; background: #f0f3f7; }
.riff-loading-reference { flex: 0 0 58px; width: 58px; height: 84px; border: 2px solid #fff; border-radius: 10px; background: linear-gradient(155deg, #dfe6f1, #bdc9d9); box-shadow: 0 4px 9px #20355618; }
.riff-loading-reference:nth-child(4), .riff-loading-reference:nth-child(5) { opacity: .65; }
.riff-loading-reference:nth-child(n+6) { opacity: .35; }
.riff-loading-profile { align-items: center; }
.riff-loading-profile__avatar { flex: 0 0 60px; width: 60px; height: 60px; border: 3px solid #fff; border-radius: 999px; background: linear-gradient(155deg, #dfe6f1, #bdc9d9); box-shadow: 0 4px 9px #20355618; }
.riff-loading-profile .riff-loading-reference:nth-child(4), .riff-loading-profile .riff-loading-reference:nth-child(5) { opacity: .65; }
.riff-loading-profile .riff-loading-reference:nth-child(n+6) { opacity: .35; }
.riff-loading-progress { display: flex; flex-direction: column; gap: 11px; width: 100%; }
.riff-loading-activity { display: flex; align-items: center; gap: 8px; color: #6933a1; font-size: 14px; font-weight: 500; line-height: 20px; }
.riff-loading-spinner { animation: riff-spin .9s linear infinite; }
.riff-progress { position: relative; width: 100%; height: 8px; overflow: hidden; border-radius: 999px; background: #f0f3f7; }
.riff-progress::after { position:absolute;left:28%;display:block;width:round(32%,1px);height:100%;border-radius:inherit;background:linear-gradient(in oklab 90deg,oklab(87.9% .027 -.043) 0%,oklab(50.6% .088 -.203) 50%,oklab(74.3% .061 -.099) 100%);animation:riff-progress 1.35s ease-in-out infinite alternate;content:""; }
@keyframes riff-progress { from { transform: translateX(-20%); } to { transform: translateX(20%); } }
@keyframes riff-spin { to { rotate: 360deg; } }
.riff-loading-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #788397; font-size: 12px; line-height: 18px; }
.riff-loading-complete { display: flex; align-items: center; gap: 5px; color: #596273; }
.riff-media-image { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: inherit; object-fit: cover; }

/* Partial Analysis · Paper CURRENT */
.riff-partial-analysis-card { display: flex; width: 656px; max-width: 100%; flex-direction: column; gap: 20px; padding: 24px; border-radius: 18px; background: radial-gradient(circle,rgba(101,86,122,.06) .6px,transparent .85px) center/16px 16px,radial-gradient(at 10% 70%,#DCEBFA 0%,transparent 60%),radial-gradient(at 70% 65%,#E6DDF6 0%,transparent 58%),radial-gradient(at 92% 30%,#F5E2EF 0%,transparent 55%),#FCFCFE; box-shadow: 0 2px 4px #18243a0a, 0 12px 24px #18243a14; }
.riff-partial-analysis-copy { display: flex; flex-direction: column; gap: 8px; }
.riff-partial-analysis-copy h1 { color: #202124; font-size: 24px; font-weight: 600; line-height: 30px; letter-spacing: -.025em; }
.riff-partial-analysis-copy p { color: #424852; font-size: 16px; line-height: 24px; }
.riff-partial-analysis-action { min-height: 44px; padding: 12px 16px; border: 1px solid #a786e9; background: radial-gradient(circle farthest-corner at 50% 45% in oklab,oklab(46.1% .087 -.206) 0%,oklab(50.7% .09 -.203) 55%,oklab(61.7% .089 -.17) 100%),#7138D4; font-size: 16px; line-height: 24px; box-shadow: inset 0 1px 2px #FFFFFF55,0 4px 8px #54259B33,0 10px 20px #7444CD33; }

/* Analysis · Paper CURRENT */
.riff-analysis-card { display: flex; align-items: flex-start; gap: 28px; width: 900px; max-width: 100%; min-height: 0; padding: 16px; border-radius: 18px; background:linear-gradient(in oklab 150deg,oklab(93.2% -.012 -.016/.333) 0%,oklab(98.3% -.002 -.003/.4) 100%),#f0f6fa;box-shadow:inset 0 1px 0 #ffffffaa,0 8px 18px #396e9012; }
.riff-analysis-media { position: relative; display: flex; flex: 0 0 313px; align-items: center; justify-content: center; width: 313px; height: 556px; border-radius: 20px; background: #f0f3f7; box-shadow: 0 2px 5px #2035560a, 0 10px 24px #2035561a, 0 20px 36px #2035560d; }
.riff-analysis-video { position: relative; display: flex; align-items: center; justify-content: center; width: 277px; height: 492px; overflow: hidden; border: 4px solid #fff; border-radius: 16px; background:#e5e5e7;box-shadow: 0 2px 6px #18243a12; text-decoration: none; }
.riff-analysis-duration{position:absolute;right:8px;bottom:8px;z-index:2;padding:4px 7px;border-radius:999px;color:#fff;background:#17202bcc;font-size:12px;line-height:18px;}
.riff-play, .riff-idea-play { position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #17202bcc; box-shadow: 0 1px 2px #0000000a, 0 6px 16px #00000008; }
.riff-play { width: 52px; height: 52px; }
.riff-analysis-detail { display: flex; flex: 1 1 0; min-width: 0; flex-direction: column; gap: 12px; padding-right: 12px; }
.riff-analysis-rows { display: flex; flex-direction: column; gap: 8px; }
.riff-analysis-row { overflow: hidden; border-radius: 12px; background: #e2e9f5; box-shadow: 0 2px 4px #18243a08, 0 4px 10px #18243a0c; }
.riff-analysis-row__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 28px; padding: 3px 14px; }
.riff-analysis-row__head h2 { color: #424852; font-size: 13px; font-weight: 600; line-height: 18px; }
.riff-analysis-row__status { flex: 0 0 auto; color: #52617a; font-size: 12px; font-weight: 500; line-height: 18px; }
.riff-analysis-row--working-well { background: #eaf3ed; }
.riff-analysis-row--working-well .riff-analysis-row__status { color: #286642; }
.riff-analysis-row--needs-attention { background: #f7f0de; }
.riff-analysis-row--needs-attention .riff-analysis-row__status { color: #80601e; }
.riff-analysis-row--needs-rework { background: #f7eae8; }
.riff-analysis-row--needs-rework .riff-analysis-row__status { color: #9c413b; }
.riff-analysis-row__body { display: flex; flex-direction: column; gap: 2px; min-height: 36px; padding: 8px 14px; border-radius: 12px; color: #242426; background: #fff; box-shadow: 0 -1px 3px #18243a08; }
.riff-analysis-row__body p { font-size: 14px; line-height: 20px; }
.riff-analysis-detail > .riff-actions { padding-top: 4px; }
.riff-analysis-detail > .riff-actions .riff-button--primary { width: 200px;min-width:190px;min-height:46px;padding:12px 18px; }
.riff-analysis-detail > .riff-actions .riff-button:not(.riff-button--primary){min-height:46px;padding-inline:22px;color:#6933a1;font-size:15px;line-height:18px;}
.riff-metric { position: absolute; z-index: 3; display: flex; align-items: center; gap: 9px; padding: 10px 12px; border: 1px solid #fff; border-radius: 14px; background: #fffffff5; box-shadow: 0 2px 5px #18243a0d, 0 8px 18px #18243a1c; }
.riff-metric--views { top: 14px; right: 0; }
.riff-metric--likes { bottom: 130px; left: 0; }
.riff-metric--saves { right: 0; bottom: 18px; }
.riff-metric__icon { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 10px; background: #f0f3f7; }
.riff-metric--likes .riff-metric__icon { background: #fdecf2; }
.riff-metric--saves .riff-metric__icon { background: #fff3d9; }
.riff-metric__copy { display: flex; flex-direction: column; gap: 1px; }
.riff-metric__copy strong { color: #242426; font-size: 15px; line-height: 19px; }
.riff-metric__copy small { color: #697180; font-size: 11px; line-height: 15px; }

/* Profile Analysis · Paper CURRENT */
.riff-profile-shell { display: flex; gap: 24px; width: 900px; max-width: 100%; padding: 20px; border-radius: 16px;background:linear-gradient(in oklab 150deg,oklab(93.2% -.012 -.016/.333) 0%,oklab(98.3% -.002 -.003/.4) 100%),#f0f6fa;box-shadow:inset 0 1px 0 #ffffffaa,0 8px 18px #396e9012; }
.riff-profile-card { display: flex; position: relative; flex: 0 0 320px; flex-direction: column; gap: 16px; width: 320px; padding: 18px; border-radius: 20px; background: #f0f3f7; box-shadow: 0 2px 5px #2035560a, 0 10px 24px #2035561a, 0 20px 36px #2035560d; }
.riff-profile-portrait { position: relative; flex: 0 0 240px; width: 284px; max-width: 100%; height: 240px; }
.riff-profile-portrait::before { position: absolute; top: 10px; left: 34px; width: 216px; height: 216px; border-radius: 999px; background: radial-gradient(circle, #e9edf7 0%, transparent 72%); content: ""; }
.riff-profile-avatar { position: absolute; top: 36px; left: 70px; display: flex; align-items: center; justify-content: center; width: 144px; height: 144px; border: 3px solid #fff; border-radius: 999px; background: #101114; box-shadow: 0 4px 8px #20355610, 0 14px 24px #20355629; }
.riff-profile-avatar > svg { width: 34px; height: 34px; }
.riff-profile-platform { position: absolute; right: -1px; bottom: -1px; z-index: 4; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 3px solid #fff; border-radius: 999px; background: #101114; box-shadow: 0 2px 5px #20355618; }
.riff-profile-platform svg { width: 12px; height: 12px; }
.riff-profile-platform--instagram{background:linear-gradient(in oklab 35deg,oklab(80.4% .042 .139) 0%,oklab(62.4% .209 .004) 50%,oklab(56.7% .077 -.174) 100%);}
.riff-profile-identity { position: absolute; top: 188px; left: 70px; display: flex; width: 144px; align-items: center; flex-direction: column; gap: 2px; text-align: center; }
.riff-profile-identity strong { max-width: 100%; color: #222832; font-size: 16px; font-weight: 600; line-height: 22px; overflow-wrap: anywhere; }
.riff-profile-identity span { max-width: 100%; color: #657185; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.riff-profile-metric { position: absolute; z-index: 3; display: flex; align-items: center; gap: 7px; padding: 9px; border-radius: 13px; background: #fffffff5; box-shadow: 0 2px 4px #2035560a, 0 8px 18px #2035561f; }
.riff-profile-metric--followers { top: 12px; left: 0; }
.riff-profile-metric--views{top:86px;left:192px;}
.riff-profile-metric--engagement{top:132px;left:0;}
.riff-profile-metric__icon { display: flex; flex: 0 0 25px; align-items: center; justify-content: center; width: 25px; height: 25px; border-radius: 8px; background: #eaf0ff; }
.riff-profile-metric--followers .riff-profile-metric__icon { background: #f0eafb; }
.riff-profile-metric--views .riff-profile-metric__icon{background:#f0f3f7;}
.riff-profile-metric--engagement .riff-profile-metric__icon{background:#fdecf2;}
.riff-profile-metric__copy { display: flex; flex-direction: column; gap: 1px; }
.riff-profile-metric__copy strong { color: #293344; font-size: 15px; font-weight: 600; line-height: 19px; }
.riff-profile-metric__copy small { color: #647185; font-size: 10px; line-height: 14px; }
.riff-profile-reviewed { color: #727783; font-size: 12px; line-height: 17px; }
.riff-profile-top { display: flex; flex-direction: column; gap: 10px; }
.riff-profile-top h2 { color: #4e5663; font-size: 13px; font-weight: 500; line-height: 18px; }
.riff-profile-videos { display: flex; gap: 10px; }
.riff-profile-video { position: relative; display: flex; flex:0 0 88px;align-items: flex-end;width:88px;height:156px;overflow:hidden;padding:6px;border:3px solid #fff;border-radius:10px;background:linear-gradient(160deg,#dce5f3,#aebed4);box-shadow:0 2px 4px #18243a0c,0 6px 12px #18243a1a;text-decoration:none; }
.riff-profile-video__metric { position: relative; z-index: 2; display: flex; align-items: center; gap: 3px; padding: 4px 6px; border-radius: 999px; color: #fff; background: #18202ac4; font-size: 11px; line-height: 14px; }
.riff-profile-video__metric svg { width: 12px; height: 12px; }
.riff-profile-analysis { display: flex; flex: 1 1 0; min-width: 0; flex-direction: column; gap: 12px; padding: 8px 0; }
.riff-profile-insight, .riff-profile-next { overflow:hidden;border-radius:12px;box-shadow:0 2px 4px #18243a08,0 4px 10px #18243a0c; }
.riff-profile-insight>header,.riff-profile-next>header{display:flex;align-items:center;justify-content:space-between;min-height:28px;padding:5px 14px;color:#424852;}
.riff-profile-insight>header h2,.riff-profile-next>header h2{font-size:13px;font-weight:600;line-height:18px;}
.riff-profile-insight>header span{font-size:12px;font-weight:500;line-height:18px;}
.riff-profile-insight--working{background:#ddece1}.riff-profile-insight--working header span{color:#286642}
.riff-profile-insight--improvement{background:#f3e7c9}.riff-profile-insight--improvement header span{color:#80601e}
.riff-profile-insight__body,.riff-profile-next__body{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:12px;background:#fff;}
.riff-profile-insight p,.riff-profile-next p,.riff-profile-next strong{font-size:14px;line-height:20px;}
.riff-profile-next{margin-top:auto;background:#e2e9f5;}.riff-profile-next__body{gap:2px;padding:8px 14px}.riff-profile-next .riff-button{align-self:flex-start;min-width:190px;margin-top:10px;}

/* Discovery · Paper CURRENT */
.riff-discovery-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 44px; }
.riff-discovery-title h1 { font-size: 34px; line-height: 42px; }
.riff-libraries, .riff-discovery-filters, .riff-studio-tabs { display: flex; flex: 0 0 auto; gap: 2px; padding: 4px; overflow-x: auto; border-radius: 999px; background: #f0f0f2; scrollbar-width: none; }
.riff-library, .riff-filter { flex: 0 0 auto; height:36px; min-height: 36px; padding: 8px 14px; border-color: transparent; border-radius: 999px; color: #596577; background: transparent; font-size: 13px; line-height: 18px; white-space: nowrap; }
.riff-library--active, .riff-filter--active { color: #6933a1; font-weight: 600; background: #fff; box-shadow: 0 2px 4px #29203612; }
.riff-discovery-copy { color: #6d6d72; font-size: 14px; line-height: 22px; }
.riff-discovery-filters { align-self: flex-start; gap: 2px; height: 44px; }
.riff-filter { color: #242426; line-height: 20px; }
.riff-filter--active { color:#6933a1; }
.riff-discovery-carousel { position: relative; width: 100%; height: 566px; overflow: visible; outline-offset: -3px; }
.riff-discovery-stage { position: relative; width: 999px; max-width: 100%; height: 566px; margin-inline: auto; }
.riff-idea-card { position: absolute; display: flex; flex-direction: column; gap: 10px; padding:8px; border:1px solid #ffffffcc; border-radius:24px; background-color:#f0f6fa; background-image:linear-gradient(150deg,oklab(93.2% -.012 -.016/.333) 0%,oklab(98.3% -.002 -.003/.4) 100%); box-shadow:inset 0 1px 0 #ffffffaa,0 8px 18px #396e9012; }
.riff-idea-card--active { left: 383px; top: 0; z-index: 3; width: 232px; height:454px; }
.riff-idea-card--left-one, .riff-idea-card--right-one { top: 52px; width: 196px; }
.riff-idea-card--left-one { left:181px; }
.riff-idea-card--right-one { left:622px; }
.riff-idea-card--left-two, .riff-idea-card--right-two { top: 100px; width: 160px; }
.riff-idea-card--left-two { left:24px; }
.riff-idea-card--right-two { left:815px; }
.riff-idea-media { position: relative; display: flex; flex:0 0 auto; align-items: center; justify-content: center; width: 100%; height: 266px; overflow: hidden; border:0; border-radius: 18px; background: linear-gradient(155deg, #e6ecf4, #b6c5d9); text-decoration: none; }
.riff-idea-card--active .riff-idea-media { width:214px; height: 354px; border-radius: 18px; }
.riff-idea-card--left-one .riff-idea-media, .riff-idea-card--right-one .riff-idea-media { width:178px;height:330px; }
.riff-idea-card--left-two .riff-idea-media, .riff-idea-card--right-two .riff-idea-media { width:142px;height:266px; }
.riff-idea-play { width: 40px; height: 40px; }
.riff-idea-multiplier { position: absolute; top: 10px; right: 8px; z-index: 2; display: flex; align-items: center; gap: 5px; height: 28px; padding-inline: 8px; border-radius: 999px; color: #354421; background: #e5f0c6; box-shadow: 0 2px 5px #00000016; }
.riff-idea-multiplier strong { font-size: 12px; font-weight: 600; line-height: 18px; }
.riff-idea-stats { position: absolute; bottom: 10px; left: 8px; z-index: 2; display: flex; height:28px;align-items:center;gap:8px;padding-inline:8px;border-radius:999px;background:#fffffff2;box-shadow:0 2px 5px #00000016; }
.riff-idea-stat { display: flex; align-items: center; gap: 4px; height: 28px; padding:0; border-radius: 0; color: #363940; background: transparent; box-shadow:none; }
.riff-idea-stat svg { width: 12px; height: 12px; }
.riff-idea-stat strong { font-size: 12px; font-weight: 600; line-height: 18px; }
.riff-idea-title { overflow: hidden; color: #343e4f; font-size: 13px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.riff-idea-actions { display: flex; gap: 6px; width: 100%; }
.riff-idea-actions .riff-button { flex: 1 1 0; font-size: 13px; }
.riff-idea-card--active .riff-idea-actions:has(.riff-bookmark) { width:216px;height:44px;margin-left:-1px;gap:6px; }
.riff-idea-card--active .riff-idea-actions:has(.riff-bookmark) .riff-button { flex:0 0 166px;width:166px;height:44px; }
.riff-bookmark { display: flex; flex: 0 0 44px; align-items: center; justify-content: center; width: 44px;height:44px; padding: 0; border-radius: 999px; box-shadow: 0 1px 2px #18243a0a, 0 4px 10px #18243a08; }
.riff-carousel-navigation { position: absolute; top: 506px; left: 50%; display: flex; align-items: center; justify-content:center; width:340px; gap:10px; translate: -50% 0; }
.riff-carousel-arrow { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; min-height: 36px; padding: 0; border: 0; border-radius: 999px; box-shadow: 0 1px 3px #18243a14; }
.riff-discovery-dots { display: flex; align-items: center; gap: 6px; }
.riff-discovery-dot { display: flex; align-items: center; justify-content: center; width: 14px; height: 36px; min-height: 36px; padding: 0; border: 0; background: transparent; }
.riff-discovery-dot::before { width: 5px; height: 5px; border-radius: 99px; background: #d3dbe9; content: ""; }
.riff-discovery-dot[aria-current="true"] { width: 29px; }
.riff-discovery-dot[aria-current="true"]::before { width: 20px; background: #7138D4; }
.riff-carousel-hint { position: absolute; top: 552px; left: 0; width: 100%; color: #667182; font-size: 12px; line-height: 16px; text-align: center; }
.riff-catalog-provenance { position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap; }
.riff-catalog-state { display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px;padding:14px 16px;border:1px solid #e3e7ee;border-radius:16px;color:#596577;background:#fff;font-size:14px;line-height:20px; }

/* Studio · Paper CURRENT */
.riff-studio-header { display: flex; align-items: flex-end; align-self: flex-start; justify-content: space-between; gap: 24px; width: 900px; max-width: 100%; }
.riff-studio-title h1 { font-size: 30px; line-height: 36px; }
.riff-studio-title { display: flex; flex-direction: column; gap: 10px; }
.riff-studio-subtitle { color: #6d6d72; font-size: 14px; line-height: 20px; }
.riff-studio-actions { flex: 0 0 auto; justify-content: flex-end; }
.riff-studio-actions .riff-button:first-child { font-weight:500; }
.riff-studio-variants { display:flex;align-self:flex-start;max-width:900px;gap:4px;padding:3px;overflow-x:auto;border:1px solid #e3e8f1;border-radius:999px;background:#f0f3f7;scrollbar-width:none; }
.riff-studio-variant { appearance:none;min-height:32px;padding:6px 12px;border:1px solid transparent;border-radius:999px;color:#52617a;background:transparent;font:600 13px/18px var(--font-sans,system-ui,sans-serif);white-space:nowrap;cursor:pointer; }
.riff-studio-variant[aria-checked="true"] { color:#6933a1;background:#fff;box-shadow:0 1px 3px #18243a14; }
.riff-studio-shell { display: flex; align-self: flex-start; flex-direction: column; gap: 18px; width: 900px; max-width: 100%; padding: 18px; border-radius: 18px; background:linear-gradient(in oklab 150deg,oklab(93.2% -.012 -.016/.333) 0%,oklab(98.3% -.002 -.003/.4) 100%),#f0f6fa; box-shadow:inset 0 1px 0 #ffffffaa,0 8px 18px #396e9012; }
.riff-studio-shell--part { gap:24px;padding:20px;background:radial-gradient(circle,rgba(101,86,122,.06) .6px,transparent .85px) center/16px 16px,radial-gradient(at 10% 70%,#DCEBFA 0%,transparent 60%),radial-gradient(at 70% 65%,#E6DDF6 0%,transparent 58%),radial-gradient(at 92% 30%,#F5E2EF 0%,transparent 55%),#FCFCFE;box-shadow:0 2px 4px #18243a0a,0 12px 24px #18243a14; }
.riff-studio-tabs { width: 100%; height: 44px; gap: 8px; }
.riff-studio-tab { display: flex; flex: 1 0 auto; align-items: center; justify-content: center; height: 36px; min-height: 36px; padding: 8px; border-color: transparent; border-radius: 999px; color: #52617a; background: transparent; font-size: 15px; font-weight: 600; line-height: 18px; }
.riff-studio-tab[aria-selected="true"] { color: #6933a1; background: #fff; box-shadow: 0 1px 3px #18243a14; }
.riff-studio-body { display: flex; align-items: flex-start; gap: 24px; }
.riff-studio-player { position: relative; display: flex; flex: 0 0 240px; align-items: center; justify-content: center; width: 240px; height: 427px; overflow: hidden; border: 4px solid #fff; border-radius: 16px; background: linear-gradient(155deg, #e5ebf3, #b7c4d4); box-shadow: 0 3px 6px #18243a10, 0 12px 24px #18243a20; text-decoration: none; }
.riff-studio-player__label, .riff-studio-player__time { position: absolute; left: 12px; z-index: 2; padding: 5px 10px; border-radius: 999px; color: #fff; background: #18202bcc; font-size: 12px; line-height: 18px; }
.riff-studio-player__label { top: 12px; padding-block: 6px; }
.riff-studio-player__time { bottom: 8px; }
.riff-studio-player__play { z-index: 2; display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 50%; background: #202020; }
.riff-studio-player--unavailable { background:#e9edf3; }
.riff-studio-player__unavailable { z-index:1;max-width:170px;padding:10px 12px;border:1px solid #cbd3df;border-radius:10px;color:#52617a;background:#ffffffd9;font-size:13px;line-height:18px;text-align:center; }
.riff-studio-panel { display: flex; flex: 1 1 0; min-width: 0; flex-direction: column; gap: 16px; }
.riff-studio-panel__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.riff-studio-panel__header h2 { color: #242426; font-size: 24px; font-weight: 600; line-height: 30px; letter-spacing: -.025em; }
.riff-script-part { overflow: hidden; border-radius: 12px; background: #eff4ff; box-shadow: 0 2px 4px #18243a0c, 0 5px 12px #18243a14; }
.riff-script-part > h3 { padding: 7px 14px; color: #4e5663; font-size: 13px; font-weight: 600; line-height: 18px; }
.riff-script-part__body { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border-radius: 12px; background: #fff; }
.riff-script-part__body > p { color: #242426; font-size: 16px; line-height: 23px; white-space: pre-wrap; }
.riff-filming-tip { display: flex; align-items: flex-start; align-self: flex-start; gap: 6px; max-width: 100%; padding: 5px 8px; border-radius: 6px; color: #79602d; background: #fff7df; }
.riff-filming-tip svg { flex: 0 0 auto; margin-top: 2px; }
.riff-filming-tip p { font-size: 12px; font-style: italic; line-height: 17px; }
.riff-filming-tip--legacy { background:#f5f6f8;color:#596273; }
.riff-on-screen-text { padding:7px 9px;border-left:3px solid #8e72c2;border-radius:4px;color:#4e5663;background:#f4f0fb;font-size:13px!important;line-height:19px!important; }
.riff-studio-references { z-index:1;display:flex;align-self:flex-start;flex-direction:column;gap:8px;width:900px;max-width:100%;padding-top:2px; }
.riff-studio-references h2 { color:#242426;font-size:16px;font-weight:600;line-height:22px; }
.riff-studio-reference { display:flex;flex-direction:column;gap:3px;padding:10px 12px;border:1px solid #e3e8f1;border-radius:10px;color:#52617a;background:#fff;text-decoration:none;overflow-wrap:anywhere; }
.riff-studio-reference strong { color:#242426;font-size:14px;line-height:20px; }
.riff-studio-reference span,.riff-studio-references__unavailable { color:#596273;font-size:12px;line-height:18px; }
.riff-studio-caption { z-index: 1; display: flex; align-self: flex-start; flex-direction: column; gap: 14px; width: 900px; max-width: 100%; padding-block: 20px; border-top: 1px solid #e5e5e7; }
.riff-studio-caption__header { display: flex; align-items: center; gap: 12px; }
.riff-studio-caption__header h2 { color: #242426; font-size: 16px; font-weight: 600; line-height: 22px; }
.riff-caption-copy { display: flex; flex: 0 0 32px; align-items: center; justify-content: center; width: 32px; height: 32px; min-height: 32px; padding: 0; border: 1px solid #e3e8f1; border-radius: 999px; background: #f3f6fc; box-shadow: 0 2px 4px #2035560a; cursor: pointer; }
.riff-caption-platforms { display:flex;gap:2px;padding:3px;border-radius:999px;background:#f0f3f7; }
.riff-caption-platform { appearance:none;display:flex;align-items:center;height:30px;min-height:30px;padding-inline:14px;border:1px solid transparent;border-radius:999px;color:#596273;background:transparent;font:600 13px/18px var(--font-sans,system-ui,sans-serif);cursor:pointer; }
.riff-caption-platform[aria-pressed="true"] { color:#202020;background:#fff;box-shadow:0 1px 2px #0000000a,0 6px 16px #00000008; }
.riff-studio-caption__copy { color: #242426; font-size: 16px; line-height: 24px; }
.riff-studio-caption__hashtags { color: #6d6d72; font-size: 14px; line-height: 20px; }

@media (max-width: 900px) {
  .riff-paper--analysis, .riff-paper--profile { padding-inline: 28px; }
  .riff-analysis-card, .riff-profile-shell, .riff-studio-header, .riff-studio-shell { width: 100%; }
  .riff-analysis-card { gap: 20px; }
  .riff-analysis-media { flex-basis: 290px; width: 290px; }
  .riff-discovery-header { align-items: flex-start; flex-direction: column; }
  .riff-libraries { max-width: 100%; }
  .riff-discovery-carousel { overflow: hidden; }
  .riff-carousel-navigation { width:min(340px,100%); }
  .riff-idea-card--active { left:50%;translate:-50% 0; }
  .riff-idea-card--left-two, .riff-idea-card--right-two { display: none; }
}
@media (max-width: 700px) {
  .riff-paper--analysis, .riff-paper--profile, .riff-paper--discovery, .riff-paper--studio { padding: 22px 18px 28px; }
  .riff-analysis-card, .riff-profile-shell, .riff-studio-body { align-items: stretch; flex-direction: column; }
  .riff-analysis-media, .riff-profile-card { flex-basis: auto; width: 100%; }
  .riff-profile-portrait { width: 100%; }
  .riff-profile-avatar, .riff-profile-identity { left: 50%; translate: -50% 0; }
  .riff-analysis-media { height: min(556px, 145vw); }
  .riff-analysis-video { width: min(277px, calc(100% - 36px)); height: calc(100% - 64px); }
  .riff-profile-card { max-width: 420px; }
  .riff-profile-videos { width:100%; }
  .riff-profile-video { flex:1 1 0;width:auto;min-width:0; }
  .riff-studio-header { align-items: stretch; flex-direction: column; }
  .riff-studio-actions { justify-content: flex-start; }
  .riff-studio-variants { max-width:100%; }
  .riff-studio-player { align-self: center; }
  .riff-studio-body .riff-studio-player { flex-basis:427px; }
  .riff-studio-tabs { justify-content: flex-start; }
  .riff-studio-tab { flex-basis: auto; padding-inline: 18px; }
  .riff-idea-card:not(.riff-idea-card--active) { display: none; }
}
@media (max-width: 380px) {
  .riff-paper--analysis, .riff-paper--profile, .riff-paper--discovery, .riff-paper--studio { padding-inline: 14px; }
  .riff-analysis-card, .riff-profile-shell, .riff-studio-shell { padding: 12px; }
  .riff-analysis-detail { padding-right: 0; }
  .riff-analysis-detail > .riff-actions .riff-button { width: 100%; }
  .riff-discovery-title h1 { font-size: 30px; line-height: 36px; }
  .riff-idea-card--active { width: min(232px, calc(100% - 16px)); }
  .riff-studio-player { width: min(240px, 100%); }
}
@media (prefers-reduced-motion: reduce) {
  .riff-loading-spinner, .riff-progress::after { animation: none !important; }
  .riff-studio-shell,.riff-studio-tab,.riff-studio-variant,.riff-caption-platform { animation:none!important;transition:none!important;scroll-behavior:auto!important; }
}
@media (forced-colors: active) {
  .riff-button--primary, .riff-library--active, .riff-filter--active, .riff-studio-tab[aria-selected="true"],.riff-studio-variant[aria-checked="true"],.riff-caption-platform[aria-pressed="true"] { border: 2px solid ButtonText; }
  .riff-studio-player__unavailable,.riff-studio-reference,.riff-script-part { border:1px solid CanvasText; }
}
[data-theme="dark"] .riff-paper--studio { color:#f4f5f7;background:#17191e; }
[data-theme="dark"] .riff-studio-title h1,[data-theme="dark"] .riff-studio-panel__header h2,[data-theme="dark"] .riff-studio-references h2,[data-theme="dark"] .riff-studio-caption__header h2 { color:#f4f5f7; }
[data-theme="dark"] .riff-studio-subtitle,[data-theme="dark"] .riff-studio-caption__hashtags { color:#b7bec9; }
[data-theme="dark"] .riff-studio-shell { background:#242832;box-shadow:inset 0 1px 0 #ffffff18,0 8px 18px #00000033; }
[data-theme="dark"] .riff-studio-reference,[data-theme="dark"] .riff-script-part__body { background:#1d2027;border-color:#3a404b; }
[data-theme="dark"] .riff-studio-reference strong,[data-theme="dark"] .riff-script-part__body>p,[data-theme="dark"] .riff-studio-caption__copy { color:#f4f5f7; }
[data-theme="dark"] .riff-studio-reference span { color:#c2c8d1; }
`;
