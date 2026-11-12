import type { CalculatorInput } from "../domain/calculator";
import type { Currency } from "../domain/markets";

type DemoPrices = Pick<
  CalculatorInput,
  | "coffeePrice"
  | "milkPrice"
  | "syrupPrice"
  | "packaging"
  | "otherPerCup"
  | "salePrice"
  | "rent"
  | "salaries"
  | "utilities"
  | "otherFixed"
>;

// Illustrative inputs, deliberately independent of geography and exchange rates.
// They are neither observed market prices nor minimum business requirements.
const smallUnitExample: DemoPrices = {
  coffeePrice: 20,
  milkPrice: 1.2,
  syrupPrice: 8,
  packaging: 0.15,
  otherPerCup: 0.05,
  salePrice: 3,
  rent: 300,
  salaries: 450,
  utilities: 60,
  otherFixed: 30,
};

export const demoPrices = {
  KZT: {
    coffeePrice: 10000,
    milkPrice: 600,
    syrupPrice: 3000,
    packaging: 50,
    otherPerCup: 20,
    salePrice: 1000,
    rent: 100000,
    salaries: 150000,
    utilities: 20000,
    otherFixed: 10000,
  },
  UZS: {
    coffeePrice: 250000,
    milkPrice: 15000,
    syrupPrice: 100000,
    packaging: 1500,
    otherPerCup: 500,
    salePrice: 25000,
    rent: 2500000,
    salaries: 3000000,
    utilities: 500000,
    otherFixed: 250000,
  },
  RUB: {
    coffeePrice: 2000,
    milkPrice: 100,
    syrupPrice: 600,
    packaging: 10,
    otherPerCup: 3,
    salePrice: 200,
    rent: 20000,
    salaries: 30000,
    utilities: 3000,
    otherFixed: 2000,
  },
  USD: smallUnitExample,
  EUR: smallUnitExample,
  JPY: {
    coffeePrice: 3000,
    milkPrice: 200,
    syrupPrice: 1000,
    packaging: 20,
    otherPerCup: 10,
    salePrice: 450,
    rent: 45000,
    salaries: 67500,
    utilities: 9000,
    otherFixed: 4500,
  },
  KWD: {
    coffeePrice: 6,
    milkPrice: 0.4,
    syrupPrice: 2,
    packaging: 0.05,
    otherPerCup: 0.015,
    salePrice: 1,
    rent: 100,
    salaries: 150,
    utilities: 20,
    otherFixed: 10,
  },
} as const satisfies Record<Exclude<Currency, "KGS">, DemoPrices>;
