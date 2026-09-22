// Numbers as the app and the pushes show them (pt-PT): "1234,5", "249,9 €".
const num = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2 });

export const fmtNumber = (n: number) => num.format(n);
export const fmtEuros = (n: number) => `${num.format(n)} €`;
