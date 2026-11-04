"""Workspace DuckDB runtime, serialized to the member computer.

Adapted from OpenMausBot (Apache-2.0); see core/packaging/licenses.
"""

import base64
import csv
import decimal
import html
import json
import math
import pathlib
import re
import sys
import tempfile
import uuid


def execute(arguments, root=pathlib.Path('/home/cua/workspace')):
    import duckdb
    import fcntl
    root = root.resolve()
    folder = root / '.raphael-data'
    folder.mkdir(exist_ok=True)
    if folder.resolve().parent != root:
        raise ValueError('Dataset path refused')
    name = arguments['dataset']
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,47}', name):
        raise ValueError('Invalid dataset name')
    database = folder / (name + '.duckdb')
    if database.resolve().parent != folder.resolve():
        raise ValueError('Dataset path refused')
    if database.exists() and database.stat().st_size > 1024 ** 3:
        raise ValueError('Dataset size limit')
    lock = folder / (name + '.lock')
    if lock.is_symlink():
        raise ValueError('Dataset lock refused')
    with lock.open('a') as held:
        fcntl.flock(held, fcntl.LOCK_EX)
        conn = duckdb.connect(str(database), config={'memory_limit': '256MB', 'threads': '2', 'autoload_known_extensions': 'false', 'autoinstall_known_extensions': 'false'})
        try:
            if arguments['action'] == 'import':
                return import_files(conn, arguments, root, folder)
            conn.execute('SET enable_external_access=false')
            if arguments['action'] == 'list':
                cursor = conn.execute('SHOW TABLES')
            else:
                sql = arguments.get('sql', '')
                statements = conn.extract_statements(sql)
                if len(statements) != 1 or str(statements[0].type) not in ('StatementType.SELECT', 'StatementType.CREATE'):
                    raise ValueError('Use one SELECT or CREATE TABLE/VIEW AS SELECT statement')
                if str(statements[0].type) == 'StatementType.CREATE' and not re.match(r'^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)\s+[A-Za-z][A-Za-z0-9_]*\s+AS\s+', sql, re.I):
                    raise ValueError('Only named tables/views from SELECT can be saved')
                cursor = conn.execute(sql)
            columns = [item[0] for item in cursor.description or []]
            if len(columns) > 100:
                raise ValueError('Result column limit')
            rows = cursor.fetchmany(201)
            result = {'dataset': name, 'columns': columns, 'rows': rows[:200], 'truncated': len(rows) > 200}
            if arguments['action'] == 'chart':
                result['chart_path'] = chart(folder, columns, rows[:30])
            return result
        finally:
            conn.close()


def import_files(conn, arguments, root, folder):
    sources = arguments.get('sources') or []
    table = arguments.get('table', 'data')
    if not 1 <= len(sources) <= 20 or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,47}', table):
        raise ValueError('Import needs workspace sources and a table name')
    conn.execute('BEGIN')
    try:
        with tempfile.TemporaryDirectory(dir=folder) as temp:
            names = []
            for i, source in enumerate(sources):
                path = (root / source).resolve()
                if not path.is_relative_to(root) or not path.is_file() or path.stat().st_size > 100 * 1024 * 1024:
                    raise ValueError('Source unavailable or too large')
                suffix = path.suffix.lower()
                if suffix == '.xlsx':
                    import openpyxl
                    book = openpyxl.load_workbook(path, read_only=True, data_only=True, keep_links=False)
                    converted = pathlib.Path(temp) / f'{i}.csv'
                    try:
                        with converted.open('w', newline='', encoding='utf-8') as out:
                            writer = csv.writer(out)
                            for count, row in enumerate(book.active.iter_rows(values_only=True)):
                                if count > 1000000 or len(row) > 1000 or out.tell() > 100 * 1024 * 1024:
                                    raise ValueError('Workbook import limit')
                                writer.writerow(row)
                    finally:
                        book.close()
                    path, suffix = converted, '.csv'
                reader = 'read_csv' if suffix == '.csv' else 'read_parquet' if suffix == '.parquet' else None
                if reader is None:
                    raise ValueError('Use CSV, Excel or Parquet')
                name = f'_import_{i}'
                conn.execute(f'CREATE TEMP TABLE "{name}" AS SELECT * FROM {reader}(?)', [str(path)])
                names.append(name)
            union = ' UNION ALL BY NAME '.join(f'SELECT * FROM "{name}"' for name in names)
            conn.execute(f'CREATE OR REPLACE TABLE "{table}" AS {union}')
            count = conn.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
            cursor = conn.execute(f'SELECT * FROM "{table}" LIMIT 5')
            result = {'dataset': arguments['dataset'], 'table': table, 'count': count, 'columns': [r[0] for r in cursor.description], 'rows': cursor.fetchall()}
        conn.execute('COMMIT')
        return result
    except BaseException:
        conn.execute('ROLLBACK')
        raise


def chart(folder, columns, rows):
    if len(columns) != 2 or not rows or any(not isinstance(row[1], (int, float, decimal.Decimal)) or not math.isfinite(float(row[1])) or row[1] < 0 for row in rows):
        raise ValueError('Chart needs two columns: label and nonnegative finite number')
    maximum = max(float(row[1]) for row in rows) or 1
    height = len(rows) * 30 + 65
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="{height}" viewBox="0 0 800 {height}"><rect width="800" height="{height}" fill="white"/>',
             f'<text x="20" y="25" fill="black" font-family="sans-serif">{html.escape(str(columns[0]))} / {html.escape(str(columns[1]))}</text>']
    for i, row in enumerate(rows):
        y = i * 30 + 45
        parts += [f'<text x="15" y="{y + 16}" fill="black" font-family="sans-serif">{html.escape(str(row[0])[:22])}</text>',
                  f'<rect x="220" y="{y}" width="{float(row[1]) / maximum * 480:.1f}" height="20" fill="#555"/>',
                  f'<text x="710" y="{y + 16}" fill="black" font-family="sans-serif">{html.escape(str(row[1])[:12])}</text>']
    parts.append('</svg>')
    path = folder / f'chart-{uuid.uuid4().hex}.svg'
    path.write_text(''.join(parts), encoding='utf-8')
    return str(path)


if __name__ == '__main__':
    try:
        result = execute(json.loads(base64.b64decode(sys.argv[1])))
        result['columns'] = [str(value)[:120] for value in result.get('columns', [])]
        result['rows'] = [[value if value is None or isinstance(value, (int, float, bool)) else str(value)[:512] for value in row] for row in result.get('rows', [])]
        output = json.dumps(result, ensure_ascii=False, default=str)
        while len(output) > 12000 and result.get('rows'):
            result['rows'].pop()
            result['truncated'] = True
            output = json.dumps(result, ensure_ascii=False, default=str)
        if len(output) > 12000:
            raise ValueError('Result size limit; aggregate or filter first')
        print(output)
    except Exception as error:
        # Database diagnostics can contain source data; expose a bounded local result only.
        print(json.dumps({'error': type(error).__name__, 'message': str(error)[:500]}))
        raise SystemExit(1)
