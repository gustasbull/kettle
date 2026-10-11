export const riffMenuStyles = `
.riff-menu-scope { position: relative; }
.riff-menu__backdrop[hidden],.riff-menu__drawer[hidden],.riff-menu__account-menu[hidden] { display:none; }
.riff-menu-trigger { appearance:none;display:flex;width:36px;height:36px;flex:0 0 auto;align-items:center;justify-content:center;padding:0;border:1px solid #E3E7EE;border-radius:10px;color:#68717E;background:#FFF;box-shadow:0 1px 3px #18243A08;cursor:pointer; }
.riff-menu-trigger svg { width:18px;height:18px; }
.riff-menu__backdrop { appearance:none;position:absolute;z-index:40;inset:12px;padding:0;border:0;border-radius:24px;background:#18243A0B;cursor:pointer; }
.riff-menu__drawer { position:absolute;z-index:41;top:12px;bottom:12px;left:12px;display:flex;width:288px;max-width:calc(100% - 24px);min-height:0;flex-direction:column;gap:16px;overflow:auto;padding:20px 16px;border:0;border-radius:24px 0 0 24px;color:#242426;background:radial-gradient(circle,rgba(101,86,122,.06) .6px,transparent .85px) center/16px 16px,radial-gradient(at 10% 70%,#DCEBFA 0%,transparent 60%),radial-gradient(at 70% 65%,#E6DDF6 0%,transparent 58%),radial-gradient(at 92% 30%,#F5E2EF 0%,transparent 55%),#FCFCFE;box-shadow:8px 0 30px #18243A1A; }
.riff-menu__header { display:flex;height:40px;flex:0 0 auto;align-items:center;justify-content:space-between; }
.riff-menu__account-trigger { appearance:none;display:flex;min-width:0;align-items:center;gap:8px;padding:8px 10px;border:0;border-radius:12px;color:#242426;background:#F3F5F8;cursor:pointer; }
.riff-menu__account-trigger .riff-logo { width:24px;height:24px;flex:0 0 auto; }
.riff-menu__account-name { max-width:158px;overflow:hidden;font-size:16px;font-weight:600;line-height:22px;text-overflow:ellipsis;white-space:nowrap; }
.riff-menu__chevron { width:12px;height:12px;flex:0 0 auto; }
.riff-menu__close { appearance:none;display:flex;width:36px;height:36px;flex:0 0 auto;align-items:center;justify-content:center;padding:0;border:1px solid #E5E5E7;border-radius:10px;color:#68717E;background:#FFF;box-shadow:0 2px 5px #18243A0A;cursor:pointer; }
.riff-menu__nav { display:flex;flex:0 0 auto;flex-direction:column;gap:6px; }
.riff-menu__nav-button { appearance:none;display:flex;width:100%;min-height:46px;align-items:center;gap:12px;padding:12px;border:0;border-radius:12px;color:#242426;background:transparent;font-size:14px;font-weight:600;line-height:18px;text-align:left;cursor:pointer; }
.riff-menu__nav-button svg { width:18px;height:18px;flex:0 0 auto;color:#4E5663; }
.riff-menu__nav-button[aria-current="page"] { color:#6933A1;background:#F0F3F7; }
.riff-menu__nav-button[aria-current="page"] svg { color:#2F58D4; }
.riff-menu__recents { display:flex;flex:0 0 auto;flex-direction:column;gap:10px;padding:16px 0;border-top:1px solid #E5E8ED; }
.riff-menu__recent-list { display:flex;flex-direction:column;gap:10px; }
.riff-menu__section-label { padding-inline:10px;color:#707784;font-size:12px;line-height:16px; }
.riff-menu__recent { appearance:none;position:relative;display:flex;width:100%;min-height:66px;align-items:center;gap:10px;padding:10px;border:1px solid #E3E7EE;border-radius:12px;color:#242426;background:#FFF;box-shadow:0 2px 3px #18243A0A,0 5px 10px #18243A0A;text-align:left;cursor:pointer; }
.riff-menu__recent-source { position:relative;display:flex;width:40px;height:44px;flex:0 0 auto;align-items:center;justify-content:center;border:2px solid #FFF;border-radius:8px;background:linear-gradient(155deg,#EEF2F8,#DCE5F1);box-shadow:0 1px 3px #18243A14;overflow:hidden; }
.riff-menu__recent-source img { width:100%;height:100%;object-fit:cover; }
.riff-menu__platform { position:absolute;z-index:2;top:37px;left:37px;display:flex;width:20px;height:20px;align-items:center;justify-content:center;border:2px solid #FFF;border-radius:999px;color:#FFF;background:#101114;box-shadow:0 1px 3px #18243A20; }
.riff-menu__platform svg { width:12px;height:12px; }
.riff-menu__recent-copy { display:flex;min-width:0;flex:1 1 0;flex-direction:column;gap:3px; }
.riff-menu__recent-title { overflow:hidden;font-size:14px;font-weight:500;line-height:18px;text-overflow:ellipsis;white-space:nowrap; }
.riff-menu__recent-stage,.riff-menu__empty { color:#727783;font-size:12px;line-height:16px; }
.riff-menu__empty { padding:8px 10px; }
.riff-menu__spacer { min-height:24px;flex:1 1 24px; }
.riff-menu__account-menu { position:absolute;z-index:2;top:66px;left:16px;display:flex;width:256px;max-width:calc(100% - 32px);flex-direction:column;gap:4px;padding:8px;border:1px solid #E3E7EE;border-radius:14px;background:#FFF;box-shadow:0 4px 8px #18243A12,0 14px 30px #18243A24; }
.riff-menu__account-home,.riff-menu__account-action { appearance:none;display:flex;width:100%;height:40px;align-items:center;gap:12px;padding:10px;border:0;border-radius:9px;color:#424852;background:transparent;font-size:14px;line-height:20px;text-align:left;cursor:pointer; }
.riff-menu__account-home { color:#000;background:#F3F5F8;font-weight:600; }
.riff-menu__account-home span:last-child { margin-left:auto;color:#727783;font-size:16px; }
.riff-menu__account-action svg,.riff-menu__account-home svg { width:18px;height:18px;flex:0 0 auto; }
.riff-menu__usage { display:flex;min-height:59px;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;padding:12px 10px;border-bottom:1px solid #ECEEF2;color:#697180;font-size:13px;line-height:18px; }
.riff-menu__usage-state { padding:6px 9px;border-radius:8px;color:#596273;background:#F0F3F7;font-size:12px;font-weight:600;line-height:18px; }
.riff-menu__theme-switch { display:flex;width:34px;height:20px;flex:0 0 auto;align-items:center;padding:2px;border:1px solid #ADB5C2;border-radius:999px;background:#D8DDE5; }
.riff-menu__theme-switch::before { width:14px;height:14px;border-radius:999px;background:#FFF;box-shadow:0 1px 2px #18243A30;content:""; }
.riff-menu__account-action[aria-pressed="true"] .riff-menu__theme-switch { justify-content:flex-end;background:#3865F8; }
.riff-menu__create { appearance:none;display:flex;width:100%;height:48px;flex:0 0 auto;align-items:center;justify-content:center;gap:8px;padding:0;border:1px solid #A786E9;border-radius:12px;color:#FFF;background:radial-gradient(circle farthest-corner at 50% 45% in oklab,oklab(46.1% .087 -.206) 0%,oklab(50.7% .09 -.203) 55%,oklab(61.7% .089 -.17) 100%),#7138D4;box-shadow:inset 0 1px 2px #FFFFFF55,0 4px 8px #54259B33,0 10px 20px #7444CD33;font-size:14px;font-weight:500;line-height:20px;cursor:pointer; }
.riff-menu__create svg { width:16px;height:16px; }
.riff-menu__status { position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap; }
.riff-menu__drawer button:hover { filter:brightness(.985); }
@media (max-width: 360px) { .riff-menu__drawer { border-radius:20px 0 0 20px; } }
@media (forced-colors: active) { .riff-menu__backdrop { border:1px solid CanvasText; } .riff-menu__drawer { border:1px solid CanvasText; } }
`;
