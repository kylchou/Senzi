// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AllocationBar } from "@/components/ui/AllocationBar";

afterEach(cleanup);

describe("AllocationBar", () => {
  it("labels allocation and baseline separately", () => {
    render(createElement(AllocationBar, { share: 0.62, baseline: 0.4 }));
    expect(screen.getByRole("img")).toHaveAccessibleName("YES allocation 62%, NO allocation 38%, opening baseline 40%");
  });

  it("describes an empty market", () => {
    render(createElement(AllocationBar, { share: null }));
    expect(screen.getByRole("img")).toHaveAccessibleName("No credits allocated yet");
  });
});
