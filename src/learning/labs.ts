export type LabResult = {
  lab: string;
  result: Record<string, number | string | number[][] | string[]>;
  assumptions: string;
  units: string;
};

export function projectile(speed: number, degrees: number, gravity = 9.81): LabResult {
  if (speed < 0 || gravity <= 0 || degrees <= 0 || degrees >= 90) {
    throw new Error("invalid_projectile_input");
  }
  const radians = (degrees * Math.PI) / 180;
  const range = (speed * speed * Math.sin(2 * radians)) / gravity;
  return {
    lab: "projectile",
    result: { rangeMeters: range },
    assumptions: "Point mass, flat ground, no drag, constant gravity.",
    units: "m, m/s, degrees, m/s^2",
  };
}

export function strongAcidPh(concentrationMolPerLitre: number): LabResult {
  if (concentrationMolPerLitre <= 0 || concentrationMolPerLitre > 1) throw new Error("invalid_concentration");
  return {
    lab: "strong_acid_ph",
    result: { pH: -Math.log10(concentrationMolPerLitre) },
    assumptions: "Ideal strong monoprotic acid. Not a measured titration.",
    units: "mol/L",
  };
}

export function punnett(parentA: string, parentB: string): LabResult {
  if (!/^[A-Za-z]{2}$/.test(parentA) || !/^[A-Za-z]{2}$/.test(parentB)) throw new Error("invalid_alleles");
  const cells = [0, 1].flatMap((i) => [0, 1].map((j) => `${parentA[i]}${parentB[j]}`));
  return {
    lab: "punnett",
    result: { cells },
    assumptions: "Single diploid locus, independent combination of the two written alleles.",
    units: "alleles",
  };
}

export function bubbleSortSteps(values: number[]): LabResult {
  const steps: number[][] = [values.slice()];
  const arr = values.slice();
  for (let i = 0; i < arr.length; i += 1) {
    for (let j = 0; j < arr.length - i - 1; j += 1) {
      if (arr[j] > arr[j + 1]) {
        [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
        steps.push(arr.slice());
      }
    }
  }
  return {
    lab: "bubble_sort",
    result: { steps },
    assumptions: "Comparison sort illustration. Learner code is not executed.",
    units: "array index",
  };
}

export function sineSample(amplitude: number, frequency: number, phase: number, offset: number, x: number): LabResult {
  return {
    lab: "sine",
    result: { y: amplitude * Math.sin(frequency * x + phase) + offset },
    assumptions: "y = a sin(bx + c) + d evaluated at one x.",
    units: "dimensionless unless the learner assigns them",
  };
}

export const BUILT_IN_GAME = [
  { prompt: "Range formula name", answer: "projectile" },
  { prompt: "Negative log10 of strong-acid concentration", answer: "ph" },
] as const;

export function scoreBuiltInGame(answers: string[]): { score: number; total: number; learningClaim: "not_mastery"; bank: "built_in_practice_set" } {
  const score = answers.reduce((sum, answer, index) => sum + (answer.trim().toLowerCase() === BUILT_IN_GAME[index]?.answer ? 1 : 0), 0);
  return { score, total: BUILT_IN_GAME.length, learningClaim: "not_mastery", bank: "built_in_practice_set" };
}
