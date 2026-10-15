import type { ChangeAlert } from "./alert-engine";

export type AlertMessage = { from: string; to: string[]; subject: string; text: string; html: string };
const dashboardUrl = "https://website-lake-ten-95.vercel.app";
function timestamp(time: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "long" }).format(new Date(time));
}
export function alertMessages(event: ChangeAlert, recipients: string[], test = false): AlertMessage[] {
  const label = event.metric === "ph" ? "pH" : "water temperature";
  const unit = event.metric === "ph" ? "pH units" : "°C";
  const direction = event.delta > 0 ? "increase" : "decrease";
  const elapsed = Math.round((Date.parse(event.confirmed.time) - Date.parse(event.baseline.time)) / 1000);
  const fromValue = event.baseline.value.toFixed(2);
  const toValue = event.confirmed.value.toFixed(2);
  const change = `${event.delta > 0 ? "+" : ""}${event.delta.toFixed(2)} ${unit}`;
  const subject = `${test ? "[TEST: no action needed]" : "[Urgent]"} AquaSense: rapid ${label} ${direction} at Tibet Butler`;
  const action = test ? "This is a controlled setup test with synthetic readings. No emergency is being reported." :
    "Please inspect the enclosure and water promptly, verify with an independent measurement, and follow your facility's response procedure. This is a sensor-change warning, not confirmation of lethal conditions or a diagnosis.";
  const when = timestamp(event.confirmed.time);
  const text = `AquaSense | Tibet Butler Sensor\n\n${test ? "SETUP TEST" : "RAPID WATER CHANGE"}\n${action}\n\nParameter: ${label}\nEarlier reference: ${fromValue} ${unit}\nConfirmed reading: ${toValue} ${unit}\nChange: ${change} over ${elapsed} seconds\nDetected: ${when}\nSource entry: ${event.confirmed.id}\n\nThe reference is the median of three earlier readings. The threshold crossing persisted across two consecutive readings. Probe movement, cleaning, or calibration can also cause a change.\n\nLive dashboard: ${dashboardUrl}\n\nAlert ID: ${event.id}\nAutomated change-detection thresholds are not species-specific safety limits.`;
  const html = `<div style="background:#f3f5f7;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#17212b"><div style="max-width:580px;margin:auto;background:white;border:1px solid #dce2e8;border-radius:8px;padding:28px"><p style="font-size:14px;color:#536373;margin:0 0 22px">AquaSense | Tibet Butler Sensor</p><h1 style="font-size:23px;margin:0 0 14px">${test ? "Setup test" : `Rapid ${label} ${direction}`}</h1><p style="font-size:15px;line-height:1.65">${action}</p><table style="border-collapse:collapse;width:100%;font-size:15px;margin:22px 0"><tr><td style="padding:10px 0;border-bottom:1px solid #e5e9ed">Earlier reference</td><td style="text-align:right;border-bottom:1px solid #e5e9ed">${fromValue} ${unit}</td></tr><tr><td style="padding:10px 0;border-bottom:1px solid #e5e9ed">Confirmed reading</td><td style="text-align:right;border-bottom:1px solid #e5e9ed;font-weight:bold">${toValue} ${unit}</td></tr><tr><td style="padding:10px 0">Change in ${elapsed} seconds</td><td style="text-align:right;font-weight:bold">${change}</td></tr></table><p style="font-size:13px;color:#536373;line-height:1.6">Detected ${when}<br>Source entry ${event.confirmed.id}. Confirmed across two readings.</p><p style="margin:24px 0"><a href="${dashboardUrl}" style="display:inline-block;background:#244c69;color:white;padding:12px 18px;border-radius:5px;text-decoration:none">Open live readings</a></p><p style="font-size:12px;color:#647484;line-height:1.6">Probe handling can also cause a change. These detection thresholds are not species-specific safety limits. Reference values use the median of three earlier readings.</p><p style="font-size:11px;color:#647484;margin-top:20px">Alert ${event.id}</p></div></div>`;
  return recipients.map(to => ({ from: "AquaSense <alerts@urso.ws>", to: [to], subject, text, html }));
}
