import { Debug } from '../core/Debug';
import { cloneSpec, type CarSpec } from './CarSpec';

type NumKey = { [K in keyof CarSpec]: CarSpec[K] extends number ? K : never }[keyof CarSpec];

const RANGES: [NumKey, number, number, number][] = [
  ['mass', 500, 2500, 10],
  ['inertiaScale', 0.3, 2, 0.05],
  ['cgToFront', 0.8, 1.8, 0.01],
  ['cgToRear', 0.8, 1.8, 0.01],
  ['cgHeight', 0.2, 1, 0.01],
  ['peakTorque', 50, 600, 5],
  ['idleRpm', 500, 1500, 50],
  ['peakRpm', 2000, 8000, 100],
  ['redline', 4000, 9500, 100],
  ['reverseGear', 1, 5, 0.05],
  ['finalDrive', 2, 6, 0.05],
  ['driveEfficiency', 0.5, 1, 0.01],
  ['gripFront', 0.5, 2, 0.01],
  ['gripRear', 0.5, 2, 0.01],
  ['corneringStiffness', 2, 20, 0.1],
  ['peakFalloff', 0, 0.8, 0.01],
  ['handbrakeGrip', 0.05, 1, 0.01],
  ['brakeForce', 3000, 25000, 100],
  ['brakeBiasFront', 0.3, 0.9, 0.01],
  ['handbrakeForce', 0, 10000, 100],
  ['drag', 0, 1.5, 0.01],
  ['rollingResistance', 0, 40, 0.5],
  ['maxSteer', 0.2, 1, 0.01],
  ['steerSpeed', 0.5, 8, 0.1],
  ['steerReturn', 0.5, 10, 0.1],
  ['steerSpeedFalloff', 5, 100, 1],
  ['driftAssist', 0, 1, 0.01],
  ['yawDamping', 0, 2, 0.01],
];

/** lil-gui folder that live-edits a car's spec, with copy-JSON and reset. */
export function addSpecPanel(spec: CarSpec): { adopt: () => void } {
  let defaults = cloneSpec(spec);
  const f = Debug.addFolder(`Car: ${spec.name}`);
  for (const [key, min, max, step] of RANGES) f.add(spec, key, min, max, step);
  const gears = f.addFolder('gears').close();
  spec.gears.forEach((_, i) => gears.add(spec.gears, i as keyof number[], 0.5, 4, 0.01).name(`gear ${i + 1}`));
  f.add(
    {
      copy: () => {
        const json = JSON.stringify(spec, null, 2);
        void navigator.clipboard.writeText(json).catch(() => console.log(json));
      },
    },
    'copy',
  ).name('copy JSON');
  f.add(
    {
      reset: () => {
        const gears = spec.gears;
        Object.assign(spec, defaults, { gears });
        gears.splice(0, gears.length, ...defaults.gears);
        f.controllersRecursive().forEach((c) => c.updateDisplay());
      },
    },
    'reset',
  ).name('reset to default');
  return {
    /** The car was swapped under this panel: retitle it and take the current numbers as the new reset point. */
    adopt: () => {
      defaults = cloneSpec(spec);
      f.title(`Car: ${spec.name}`);
      f.controllersRecursive().forEach((c) => c.updateDisplay());
    },
  };
}
