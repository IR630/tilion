import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Select, type SelectOption } from "./Select";
import { Segmented } from "./Slide";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTS: SelectOption<string>[] = [
  { value: "sh", label: "Shackleton rim" },
  { value: "hw", label: "Haworth (HW02)" },
  { value: "nb", label: "Nobile", disabled: true },
  { value: "ma", label: "Malapert massif" },
  { value: "mb", label: "Malapert B" },
  { value: "cr", label: "Connecting ridge" },
];

let root: Root;
let host: HTMLDivElement;
const changes: string[] = [];

function Harness({ start = "hw" }: { start?: string }) {
  const [v, setV] = useState(start);
  return (
    <label>
      Site
      <Select
        label="Landing site"
        value={v}
        options={OPTS}
        onChange={(x) => {
          changes.push(x);
          setV(x);
        }}
      />
    </label>
  );
}

const button = () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]');
const activeText = () => {
  const id = button().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id)?.textContent : null;
};
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    button().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });

beforeEach(() => {
  changes.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
  button().focus();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("Select", () => {
  it("is a combobox named by its label, showing the chosen option", () => {
    expect(button().getAttribute("aria-label")).toBe("Landing site");
    expect(button().getAttribute("aria-haspopup")).toBe("listbox");
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().textContent).toBe("Haworth (HW02)");
    expect(listbox()).toBeNull();
  });

  it("opens on ArrowDown at the chosen option and moves with the arrows, skipping disabled ones", () => {
    key("ArrowDown");
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(listbox()?.getAttribute("aria-label")).toBe("Landing site");
    expect(activeText()).toBe("Haworth (HW02)");
    key("ArrowDown");
    expect(activeText()).toBe("Malapert massif"); // Nobile is disabled
    key("ArrowUp");
    expect(activeText()).toBe("Haworth (HW02)");
    expect(changes).toEqual([]);
  });

  it("stops at the ends and jumps with Home and End", () => {
    key("ArrowDown");
    key("End");
    expect(activeText()).toBe("Connecting ridge");
    key("ArrowDown");
    expect(activeText()).toBe("Connecting ridge");
    key("Home");
    expect(activeText()).toBe("Shackleton rim");
    key("ArrowUp");
    expect(activeText()).toBe("Shackleton rim");
  });

  it("Home and End open the closed list at the first and last option", () => {
    key("End");
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(activeText()).toBe("Connecting ridge");
  });

  it("Enter chooses the active option, closes and keeps focus on the button", () => {
    key("Enter");
    key("ArrowDown");
    key("Enter");
    expect(changes).toEqual(["ma"]);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().textContent).toBe("Malapert massif");
    expect(document.activeElement).toBe(button());
    expect(listbox()).toBeNull();
  });

  it("Space chooses too", () => {
    key(" ");
    key("Home");
    key(" ");
    expect(changes).toEqual(["sh"]);
  });

  it("Escape closes without a change and does not reach outer handlers", () => {
    const outer = vi.fn();
    key("ArrowDown");
    key("ArrowDown");
    window.addEventListener("keydown", outer);
    key("Escape");
    window.removeEventListener("keydown", outer);
    expect(changes).toEqual([]);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().textContent).toBe("Haworth (HW02)");
    expect(outer).not.toHaveBeenCalled();
  });

  it("type-ahead finds by prefix, cycles on a repeated letter and skips disabled options", () => {
    key("ArrowDown");
    key("m");
    expect(activeText()).toBe("Malapert massif");
    key("m");
    expect(activeText()).toBe("Malapert B");
    key("n"); // "mn" matches nothing: stays
    expect(activeText()).toBe("Malapert B");
  });

  it("type-ahead builds a word from quick keys", () => {
    vi.useFakeTimers();
    key("ArrowDown");
    key("m");
    key("a");
    key("l");
    key("a");
    key("p");
    key("e");
    key("r");
    key("t");
    expect(activeText()).toBe("Malapert massif");
    key(" "); // inside a typed name a space searches on
    key("b");
    expect(activeText()).toBe("Malapert B");
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(700);
    key(" "); // after the buffer timed out a space chooses
    expect(changes).toEqual(["mb"]);
  });

  it("type-ahead on the closed button opens at the match", () => {
    key("c");
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(activeText()).toBe("Connecting ridge");
  });

  it("Tab chooses the active option and lets focus move on", () => {
    key("ArrowDown");
    key("End");
    let ev: KeyboardEvent | null = null;
    act(() => {
      ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      button().dispatchEvent(ev);
    });
    expect(changes).toEqual(["cr"]);
    expect(ev!.defaultPrevented).toBe(false);
  });

  it("a click on an option chooses it; a press outside closes without a change", () => {
    act(() => button().click());
    const opt = Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent === "Shackleton rim")!;
    expect(opt.getAttribute("aria-selected")).toBe("false");
    act(() => (opt as HTMLElement).click());
    expect(changes).toEqual(["sh"]);
    act(() => button().click());
    expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe("Shackleton rim");
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(changes).toEqual(["sh"]);
  });

  it("a click on a disabled option does nothing", () => {
    act(() => button().click());
    const nb = Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent === "Nobile") as HTMLElement;
    expect(nb.getAttribute("aria-disabled")).toBe("true");
    act(() => nb.click());
    expect(changes).toEqual([]);
    expect(button().getAttribute("aria-expanded")).toBe("true");
  });

  it("renders the list outside the label, so a click on it does not re-toggle the button", () => {
    act(() => button().click());
    expect(host.contains(listbox())).toBe(false);
  });
});

describe("Segmented", () => {
  it("presses one option and carries one sliding mark", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <Segmented
          label="Range"
          value="80"
          onChange={onChange}
          options={[
            { value: "80", label: "80–90°S" },
            { value: "60", label: "60–90°S" },
          ]}
        />,
      ),
    );
    const group = host.querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-label")).toBe("Range");
    const pressed = Array.from(group.querySelectorAll("button")).map((b) => b.getAttribute("aria-pressed"));
    expect(pressed).toEqual(["true", "false"]);
    expect(group.querySelectorAll(".ui-slide").length).toBe(1);
    act(() => group.querySelectorAll("button")[1].click());
    expect(onChange).toHaveBeenCalledWith("60");
  });
});
