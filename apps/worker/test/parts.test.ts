import { describe, expect, it } from "vitest";
import { parseParts, singlePart } from "../src/pipeline/parts.js";

const key = (title: string) => singlePart(title)?.key ?? null;

describe("singlePart", () => {
  it("reads graphics cards in any language, with Ti/Super/XT variants", () => {
    expect(key("Scheda video Nvidia GeForce RTX 3060 Ti Aorus Elite 8GB usata")).toBe("gpu:rtx-3060-ti");
    expect(key("Gigabyte Vision 3060Ti 8GB")).toBe("gpu:rtx-3060-ti");
    expect(key("Soyo NVIDIA rtx 3060 12gb, come nuova")).toBe("gpu:rtx-3060");
    expect(key("Grafica KFA2 2060Super")).toBe("gpu:rtx-2060-super");
    expect(key("Carte Graphique MSI GeForce GTX 1660 SUPER Ventus XS 6Go")).toBe("gpu:gtx-1660-super");
    expect(key("GRAFICAS Em Estoque 1660super -PRONTA ENTREGA!")).toBe("gpu:gtx-1660-super");
    expect(key("gtx Nvidia 1060")).toBe("gpu:gtx-1060");
    expect(key("GTX1060 3GB evga")).toBe("gpu:gtx-1060");
    expect(key("Rx6600 8gb")).toBe("gpu:rx-6600");
    expect(key("rx 6900 xt asrock")).toBe("gpu:rx-6900-xt");
    expect(key("Sapphire Pulse Radeon RX 7800 XT")).toBe("gpu:rx-7800-xt");
    expect(key("Gigabyte RX 560 Gaming OC 2Gb Gddr5")).toBe("gpu:rx-560");
    expect(key("Msi rtx 3070 ventus 2x 8gb oc lhr gddr6")).toBe("gpu:rtx-3070");
    expect(key("Rtx 3080 ti Eagle")).toBe("gpu:rtx-3080-ti");
    expect(singlePart("Gráfica Nvidia GeForce RTX 2060 Super 8GB")?.label).toBe("RTX 2060 Super");
  });

  it("reads processors", () => {
    expect(key("Processeur Intel Core i9-12900K")).toBe("cpu:i9-12900k");
    expect(key("Intel Core i7-6700 – 3.40 GHz")).toBe("cpu:i7-6700");
    expect(key("Ryzen 5 3600X")).toBe("cpu:ryzen-3600x");
    expect(key("AMD R7 7800x3d")).toBe("cpu:ryzen-7800x3d");
    expect(key("ryzen 5600")).toBe("cpu:ryzen-5600");
    expect(singlePart("Ryzen 5 3600X")?.label).toBe("Ryzen 5 3600X");
    expect(singlePart("i5 10400f")?.label).toBe("i5-10400F");
  });

  it("reads RAM, disks, power supplies and motherboards", () => {
    expect(key("16 go Ram ddr5")).toBe("ram:ddr5-16");
    expect(key("RAM Ballistix 8 Go DDR4")).toBe("ram:ddr4-8");
    expect(key("16GB RAM 4 x 4GB Crucial Ballistix DDR4")).toBe("ram:ddr4-16");
    expect(key("Corsair Vengeance RGB Pro RGB 64 Go (4×16 Go) DDR4 3200 MHz CL16 – Noir")).toBe("ram:ddr4-64");
    expect(key("Ram Sodimm 8GB DDR4 (2x4gb) Micron")).toBe("ram:ddr4-8-sodimm");
    expect(key("SSD 512 Go")).toBe("storage:ssd-512");
    expect(key('ssd kingston a400 480gb 2.5" sata iii - sa400s37/480g')).toBe("storage:ssd-512");
    expect(key("Ssd pny 1 to nvm express")).toBe("storage:ssd-1000");
    expect(key("HDD WD 1Tb 3.5 Sata 100%")).toBe("storage:hdd-1000");
    expect(key("1.5TB Disco Interno Western Digital Sata 3.5 WD15EARS usado")).toBe("storage:hdd-1500");
    expect(key("Fonte Corsair 650W 80+ Bronze")).toBe("psu:650");
    expect(key("Carte mere mag Z390 tomahawk")).toBe("mb:z390");
    expect(singlePart("Carte mere mag Z390 tomahawk")?.label).toBe("Motherboard Z390");
  });

  it("rejects whole PCs, laptops, combos, lots and broken parts", () => {
    expect(key("HP Victus RTX 3060 Ryzen 7 16GB 512GB")).toBeNull();
    expect(key("PC Asus i3-7100 Negro")).toBeNull();
    expect(key("PC Portable Gamer MSI GF65 Thin – RTX 3060 – i5 – 16 Go RAM – 144 Hz")).toBeNull();
    expect(key("Ryzen 7 3700X + Placa base asus + 16Gb de RAM")).toBeNull();
    expect(key("LOT 2x MSI GeForce GTX 1660 SUPER Gaming X 6GB - Testées & Fonctionnelles")).toBeNull();
    expect(key("Hard disk SSD 240gb wd originale + RAM 2 GB DDR3 sodimm")).toBeNull();
    expect(key("RTX 3070 avariada")).toBeNull();
    expect(key("CPU cooler AVC c6254nc")).toBeNull();
    expect(key("Disco Externo 750GB — Testado e Funcional")).toBeNull();
  });

  it("takes a number without GTX/RTX for a card only when the title shows one", () => {
    expect(key("Gigabyte 1660 super")).toBe("gpu:gtx-1660-super");
    expect(key("3060 12g")).toBe("gpu:rtx-3060");
    expect(key("Rtx force 2060")).toBe("gpu:rtx-2060");
    expect(parseParts("Pc gaming 1060 i5").map((p) => p.key)).toContain("gpu:gtx-1060");
    for (const title of ["Dell OptiPlex 3050 Sff – Core i3-7100 , 8 Go Ram ,256 Go Ssd", "Dell wyse 5070 Thin Client", "Webcam Pro 1080 p",
      "Impressora HP Deskjet 3050", "PC completo Dell Optiplex 3060 i5 8500"]) {
      expect(parseParts(title).some((p) => p.type === "gpu")).toBe(false);
    }
  });

  it("needs a model", () => {
    expect(key("Carte graphique NVIDIA")).toBeNull();
    expect(key("Ram Corsair 32 gb")).toBeNull();
    expect(key("Nvidia QUADRO 600")).toBeNull();
  });
});

describe("parseParts", () => {
  it("lists every part of a PC, and the types named without a model", () => {
    expect(parseParts("PC Gaming Ryzen 9 3900X RTX 3070 Ti 64GB RAM ssd 1TB").map((p) => p.key)).toEqual([
      "gpu:rtx-3070-ti",
      "cpu:ryzen-3900x",
      "storage:ssd-1000",
      null, // RAM without DDR generation
    ]);
    expect(parseParts("Placa gráfica 8GB")).toEqual([{ type: "gpu", key: null, label: null }]);
    expect(parseParts("PC gaming i5 com gráfica").map((p) => p.type)).toEqual(["gpu", "cpu"]);
  });
});
