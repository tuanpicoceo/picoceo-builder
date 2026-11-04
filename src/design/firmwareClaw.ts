// The LicheeRV Claw kit (LicheeRV Nano W + PicoClaw board) runs the generic Linux voice robot app
// (firmwareLinux.ts) with the Claw platform adapter: PicoClaw side keys 504 / 509 and LEDs 495 / 498 on sysfs GPIO,
// the 240x240 LCD on /dev/fb0, ALSA default mic + speaker, PCA9685 on I2C, and the stock PicoClaw app stopped
// while it runs. Kept as its own module so existing imports (clawAppId, clawFirmwareFiles) keep working.

import type { Assembly } from '../cad/types';
import type { Behavior } from './behaviors';
import type { RobotSpec } from './spec';
import { linuxAppId, linuxFirmwareFiles } from './firmwareLinux';

/** Folder / app id on the device, e.g. "app_desk_buddy". */
export const clawAppId = linuxAppId;

export function clawFirmwareFiles(spec: RobotSpec, a: Assembly, behaviors: Behavior[]): Record<string, string> {
  return linuxFirmwareFiles({ ...spec, platform: 'licheerv_claw' }, a, behaviors);
}
