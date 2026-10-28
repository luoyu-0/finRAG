import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Pagination } from "../../src/components/Pagination";

describe("Pagination", () => {
  it("展示当前区间与总数", () => {
    render(<Pagination page={2} pageSize={10} total={35} hasNext onChange={() => undefined} />);

    expect(screen.getByText("第 11–20 条，共 35 条")).toBeInTheDocument();
    expect(screen.getByText("第 2 页")).toBeInTheDocument();
  });

  it("第一页时禁用上一页", () => {
    render(<Pagination page={1} pageSize={10} total={35} hasNext onChange={() => undefined} />);

    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
  });

  it("没有下一页时禁用下一页", () => {
    render(
      <Pagination page={1} pageSize={10} total={5} hasNext={false} onChange={() => undefined} />,
    );

    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
  });

  it("点击按钮时回调目标页码", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(page: number) => void>();
    render(<Pagination page={2} pageSize={10} total={35} hasNext onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(onChange).toHaveBeenCalledWith(3);

    await user.click(screen.getByRole("button", { name: "上一页" }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("总数为 0 时不渲染", () => {
    const { container } = render(
      <Pagination page={1} pageSize={10} total={0} hasNext={false} onChange={() => undefined} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
