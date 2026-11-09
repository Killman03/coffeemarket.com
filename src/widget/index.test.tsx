import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { mountCoffeeCalculator } from "./index";
import { Calculator } from "../presentation/Calculator";
import { catalogRepository } from "../infrastructure/catalog-repository";

vi.mock("../presentation/ProfitChart", () => ({
  ProfitChart: () => <div>График</div>,
}));
afterEach(() => {
  window.localStorage.clear();
});

describe("embedded integration", () => {
  it("mounts without store chrome and releases its DOM on unmount", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let unmount: () => void = () => {};
    await act(async () => {
      unmount = mountCoffeeCalculator(host);
    });
    expect(host.querySelector("h2")).toHaveTextContent(
      "Сколько приносит ваша чашка кофе?",
    );
    expect(host.querySelector("nav")).toBeNull();
    expect(host.querySelector("footer")).toBeNull();
    await act(async () => {
      unmount();
    });
    expect(host).toBeEmptyDOMElement();
    host.remove();
  });

  it("validates host-provided catalog before rendering", () => {
    const host = document.createElement("div");
    expect(() =>
      mountCoffeeCalculator(host, { catalog: { products: [] } }),
    ).toThrow();
    expect(host).toBeEmptyDOMElement();
  });

  it("uses unique field and accessibility IDs across two instances", () => {
    const catalog = catalogRepository.getCatalog();
    render(
      <>
        <Calculator catalog={catalog} headingLevel={2} />
        <Calculator catalog={catalog} headingLevel={2} />
      </>,
    );
    const ids = Array.from(
      document.querySelectorAll("[id]"),
      (element) => element.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(screen.getAllByLabelText("Цена кофе")).toHaveLength(2);
    for (const label of document.querySelectorAll("label[for]")) {
      expect(
        document.getElementById(label.getAttribute("for")!),
      ).not.toBeNull();
    }
  });

  it("allows host pages to provide their own title", () => {
    render(
      <Calculator catalog={catalogRepository.getCatalog()} showIntro={false} />,
    );
    expect(screen.queryByText("Сколько приносит ваша чашка кофе?")).toBeNull();
    expect(screen.getByLabelText("Цена кофе")).toBeInTheDocument();
  });
});
