#!/usr/bin/env python3
"""Split a sheet export (.xlsx from the Drive connector) into one CSV per tab, for the Node scripts to read.

    python3 -I agency-desk/scripts/split-xlsx.py <export.xlsx> <out dir outside the repo>

Needs openpyxl (`pip install openpyxl`). The sheets hold real names and addresses, so the output must live in the
scratchpad: it refuses a folder inside this public repository.
"""
import csv, os, sys

def main():
    if len(sys.argv) != 3:
        sys.exit('usage: split-xlsx.py <export.xlsx> <out dir>')
    src, out = sys.argv[1], os.path.abspath(sys.argv[2])
    repo = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
    if out == repo or out.startswith(repo + os.sep):
        print(f'refusing to write inside the repository ({out}); personal data belongs in the scratchpad', file=sys.stderr)
        sys.exit(2)
    import openpyxl
    os.makedirs(out, exist_ok=True)
    wb = openpyxl.load_workbook(src, data_only=True, read_only=True)
    for ws in wb.worksheets:
        rows = [['' if v is None else str(v).replace('\r', '').strip() for v in r] for r in ws.iter_rows(values_only=True)]
        while rows and not any(rows[-1]):
            rows.pop()
        name = ws.title.replace('/', '_').replace(' ', '_')
        with open(os.path.join(out, f'{name}.csv'), 'w', newline='') as f:
            csv.writer(f).writerows(rows)
        print(f'{ws.title}: {sum(1 for r in rows if any(r))} rows')

if __name__ == '__main__':
    main()
