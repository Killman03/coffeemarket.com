"""Normalize an Artifact Tool workbook for the ExcelJS template reader.

Artifact Tool authors the complete workbook. ExcelJS does not support its valid
namespace-prefixed SpreadsheetML tags. A standard openpyxl read/save normalizes
the serialization without hand-editing XML. This is an authoring step only.
"""

import argparse
from pathlib import Path

from openpyxl import load_workbook


def normalize(path: Path) -> None:
    """Re-serialize an authored workbook using a namespace-aware XLSX engine.

    Args:
        path: Trusted locally authored XLSX template to normalize in place.
    """
    workbook = load_workbook(path)
    workbook.save(path)
    workbook.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("template", type=Path)
    normalize(parser.parse_args().template)
