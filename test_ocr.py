import argparse
from pathlib import Path

from process_docs import extract_text_from_image


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="识别单张图片中的文字")
    parser.add_argument("image", type=Path, help="待识别图片路径")
    args = parser.parse_args(argv)
    if not args.image.is_file():
        parser.error(f"图片不存在：{args.image}")

    print(extract_text_from_image(args.image), end="")


if __name__ == "__main__":
    main()
