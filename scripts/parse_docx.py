#!/usr/bin/env python3
"""一次性脚本：解析三个 DOCX 文件，生成训练数据 JSON。
用法：python3 scripts/parse_docx.py [--output-dir data/import]
"""

import argparse
import hashlib
import json
import os
import sys
import re
from collections import Counter
from docx import Document
from docx.document import Document as DocumentObject
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(ROOT_DIR, 'data', 'import')


def clean_text(text):
    """去除零宽字符、统一换行、保留中文标点。"""
    if not text:
        return ''
    text = str(text)
    # 去除零宽字符
    text = re.sub(r'[\u200b\u200c\u200d\u200e\u200f\u2060\u2061\u2062\u2063\u2064\ufeff\u00ad]', '', text)
    # 统一换行
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    # 去除行末多余空格
    text = re.sub(r'[ \t]+\n', '\n', text)
    # 压缩多个空行为两个
    text = re.sub(r'\n{4,}', '\n\n', text)
    return text.strip()


def iter_document_blocks(document):
    """按 Word 中的真实顺序读取段落和表格单元格。"""
    if not isinstance(document, DocumentObject):
        raise TypeError('document 必须是 python-docx Document')

    for child in document.element.body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, document)
        elif isinstance(child, CT_Tbl):
            table = Table(child, document)
            for row in table.rows:
                for cell in row.cells:
                    for paragraph in cell.paragraphs:
                        yield paragraph


def read_docx_paragraphs(filepath):
    """读取 DOCX 所有段落及表格内容，返回纯文本列表。"""
    doc = Document(filepath)
    paragraphs = []
    for para in iter_document_blocks(doc):
        text = clean_text(para.text)
        paragraphs.append(text)
    return paragraphs


# ===== 朗诵训练解析 =====

def parse_reading(paragraphs):
    """解析「朗诵训练0720.docx」，以「每日练嘴：」为标题分隔符。"""
    items = []
    current_title = None
    current_lines = []

    for para in paragraphs:
        if not para:
            if current_title is not None:
                # 空行保留在正文中
                current_lines.append('')
            continue

        # 检查是否是标题行「每日练嘴：...」
        match = re.match(r'^每日练嘴[：:]\s*(.+)$', para)
        if match:
            # 保存前一项
            if current_title is not None:
                body = '\n'.join(current_lines).strip()
                items.append({
                    'title': current_title,
                    'content': body
                })
            current_title = match.group(1).strip()
            current_lines = []
        else:
            if current_title is not None:
                current_lines.append(para)

    # 保存最后一项
    if current_title is not None:
        body = '\n'.join(current_lines).strip()
        items.append({
            'title': current_title,
            'content': body
        })

    return items


# ===== 复述训练解析 =====

def parse_retell(paragraphs):
    """解析「每日复述练嘴.docx」，以「每日复述练嘴：」为标题分隔符。"""
    items = []
    current_title = None
    current_lines = []

    for para in paragraphs:
        if not para:
            if current_title is not None:
                current_lines.append('')
            continue

        match = re.match(r'^每日复述练嘴[：:]\s*(.+)$', para)
        if match:
            if current_title is not None:
                body = '\n'.join(current_lines).strip()
                items.append({
                    'title': current_title,
                    'content': body
                })
            current_title = match.group(1).strip()
            current_lines = []
        else:
            if current_title is not None:
                current_lines.append(para)

    if current_title is not None:
        body = '\n'.join(current_lines).strip()
        items.append({
            'title': current_title,
            'content': body
        })

    return items


# ===== 演讲训练解析 =====

def parse_speech(paragraphs):
    """解析「演讲0720.docx」，以「演讲：」为标题分隔符。
    处理标题和正文可能在同一段落的特殊情况（标题后跟换行符）。"""
    items = []
    current_title = None
    current_lines = []

    for para in paragraphs:
        if not para:
            if current_title is not None:
                current_lines.append('')
            continue

        # 检查段落是否以「演讲：」开头
        match = re.match(r'^演讲[：:]\s*(.+)', para, re.DOTALL)
        if match:
            title_and_rest = match.group(1).strip()
            # 检查标题后面是否在同一段内紧跟了正文（通过 \n 分隔）
            if '\n' in title_and_rest:
                parts = title_and_rest.split('\n', 1)
                actual_title = parts[0].strip()
                body_start = parts[1].strip()
            else:
                actual_title = title_and_rest
                body_start = None

            # 保存前一项
            if current_title is not None:
                body = '\n'.join(current_lines).strip()
                items.append({
                    'title': current_title,
                    'content': body
                })

            current_title = actual_title
            current_lines = []
            if body_start:
                current_lines.append(body_start)
        else:
            if current_title is not None:
                current_lines.append(para)

    if current_title is not None:
        body = '\n'.join(current_lines).strip()
        items.append({
            'title': current_title,
            'content': body
        })

    return items


def extract_golden_sentence(content):
    """从演讲正文中提取金句，但绝不改写或删除原正文。"""
    match = re.search(r'(?:^|\n)金句\s*[：:]\s*(.+)$', content, re.DOTALL)
    return match.group(1).strip() if match else ''


def build_reading_items(items):
    """构建朗诵训练条目。"""
    result = []
    for i, item in enumerate(items):
        day = i + 1
        content = item['content']
        result.append({
            'contentId': f'reading-day-{day}',
            'category': 'reading',
            'categoryName': '朗读训练',
            'day': day,
            'dayNumber': day,
            'sortOrder': day,
            'title': item['title'],
            'author': '',
            'content': content,
            'material': content,
            'promptText': content,
            'isCustom': False,
            'membershipLevel': 'free' if day <= 21 else 'member',
            'status': 'published',
            'visible': True
        })
    return result


def build_retell_items(items):
    """构建复述训练条目。"""
    result = []
    for i, item in enumerate(items):
        day = i + 1
        content = item['content']
        result.append({
            'contentId': f'retelling-day-{day}',
            'category': 'retelling',
            'categoryName': '复述训练',
            'day': day,
            'dayNumber': day,
            'sortOrder': day,
            'title': item['title'],
            'author': '',
            'content': content,
            'material': content,
            'promptText': content,
            'isCustom': False,
            'membershipLevel': 'free' if day <= 21 else 'member',
            'status': 'published',
            'visible': True
        })
    return result


def build_speech_items(items):
    """构建演讲训练条目。"""
    result = []
    for i, item in enumerate(items):
        day = i + 1
        content = item['content']
        quote = extract_golden_sentence(content)

        result.append({
            'contentId': f'speech-day-{day}',
            'day': day,
            'title': item['title'],
            'articleCategory': '励志演讲',
            'content': content,
            'quote': quote
        })
    return result


def get_duplicate_titles(items):
    """返回所有重复标题及其 1-based 位置。"""
    title_counts = Counter(item['title'] for item in items)
    return [
        {
            'title': title,
            'positions': [index + 1 for index, item in enumerate(items) if item['title'] == title]
        }
        for title, count in title_counts.items()
        if count > 1
    ]


def build_category_summary(category, items, built_items, source_file):
    lengths = [len(item['content']) for item in items]
    content_ids = [item['contentId'] for item in built_items]
    days = [item['day'] for item in built_items]
    duplicate_ids = [content_id for content_id, count in Counter(content_ids).items() if count > 1]
    expected_days = list(range(1, len(items) + 1))
    min_index = lengths.index(min(lengths)) if lengths else -1
    max_index = lengths.index(max(lengths)) if lengths else -1
    digest_text = '\n\0\n'.join(f"{item['title']}\n{item['content']}" for item in items)

    return {
        'category': category,
        'sourceFile': os.path.basename(source_file),
        'sourceSha256': hashlib.sha256(open(source_file, 'rb').read()).hexdigest(),
        'count': len(items),
        'firstTitle': items[0]['title'] if items else '',
        'middle': {
            'position': len(items) // 2 + 1,
            'title': items[len(items) // 2]['title'] if items else '',
            'contentLength': lengths[len(items) // 2] if items else 0
        },
        'lastTitle': items[-1]['title'] if items else '',
        'emptyTitlePositions': [index + 1 for index, item in enumerate(items) if not item['title']],
        'emptyContentPositions': [index + 1 for index, item in enumerate(items) if not item['content']],
        'duplicateTitles': get_duplicate_titles(items),
        'duplicateContentIds': duplicate_ids,
        'daysContinuous': days == expected_days,
        'sortOrderContinuous': [item.get('sortOrder', item['day']) for item in built_items] == expected_days,
        'shortestContent': {
            'position': min_index + 1,
            'title': items[min_index]['title'] if min_index >= 0 else '',
            'length': lengths[min_index] if min_index >= 0 else 0
        },
        'longestContent': {
            'position': max_index + 1,
            'title': items[max_index]['title'] if max_index >= 0 else '',
            'length': lengths[max_index] if max_index >= 0 else 0
        },
        'contentLengths': lengths,
        'contentDigestSha256': hashlib.sha256(digest_text.encode('utf-8')).hexdigest()
    }


def parse_args():
    parser = argparse.ArgumentParser(description='从三份训练 DOCX 生成确定性训练数据')
    parser.add_argument('--source-dir', default=ROOT_DIR, help='DOCX 源文件目录')
    parser.add_argument('--output-dir', default=OUTPUT_DIR, help='JSON 输出目录')
    return parser.parse_args()


def main():
    args = parse_args()
    source_dir = os.path.abspath(args.source_dir)
    output_dir = os.path.abspath(args.output_dir)
    files = {
        'reading': os.path.join(source_dir, '朗诵训练0720.docx'),
        'retell': os.path.join(source_dir, '每日复述练嘴.docx'),
        'speech': os.path.join(source_dir, '演讲0720.docx'),
    }

    for key, filepath in files.items():
        if not os.path.exists(filepath):
            print(f'[ERROR] 文件不存在: {filepath}')
            sys.exit(1)

    # 解析
    reading_paragraphs = read_docx_paragraphs(files['reading'])
    retell_paragraphs = read_docx_paragraphs(files['retell'])
    speech_paragraphs = read_docx_paragraphs(files['speech'])

    reading_items = parse_reading(reading_paragraphs)
    retell_items = parse_retell(retell_paragraphs)
    speech_items = parse_speech(speech_paragraphs)

    print(f'朗诵训练解析: {len(reading_items)} 条')
    print(f'复述训练解析: {len(retell_items)} 条')
    print(f'演讲训练解析: {len(speech_items)} 条')
    print(f'总计: {len(reading_items) + len(retell_items) + len(speech_items)} 条')

    # 检查空标题和空正文
    empty_title_reading = [i for i, item in enumerate(reading_items) if not item['title']]
    empty_content_reading = [i for i, item in enumerate(reading_items) if not item['content']]
    empty_title_retell = [i for i, item in enumerate(retell_items) if not item['title']]
    empty_content_retell = [i for i, item in enumerate(retell_items) if not item['content']]
    empty_title_speech = [i for i, item in enumerate(speech_items) if not item['title']]
    empty_content_speech = [i for i, item in enumerate(speech_items) if not item['content']]

    if empty_title_reading:
        print(f'[WARN] 朗诵空标题: 第 {empty_title_reading} 条')
    if empty_content_reading:
        print(f'[WARN] 朗诵空正文: 第 {empty_content_reading} 条')
    if empty_title_retell:
        print(f'[WARN] 复述空标题: 第 {empty_title_retell} 条')
    if empty_content_retell:
        print(f'[WARN] 复述空正文: 第 {empty_content_retell} 条')
    if empty_title_speech:
        print(f'[WARN] 演讲空标题: 第 {empty_title_speech} 条')
    if empty_content_speech:
        print(f'[WARN] 演讲空正文: 第 {empty_content_speech} 条')

    # 验证首条和末条
    if reading_items:
        print(f'\n朗诵首条标题: {reading_items[0]["title"]}')
        print(f'朗诵末条标题: {reading_items[-1]["title"]}')
    if retell_items:
        print(f'\n复述首条标题: {retell_items[0]["title"]}')
        print(f'复述末条标题: {retell_items[-1]["title"]}')
    if speech_items:
        print(f'\n演讲首条标题: {speech_items[0]["title"]}')
        print(f'演讲末条标题: {speech_items[-1]["title"]}')

    # 检查重复标题
    def check_duplicates(name, items):
        dupes = get_duplicate_titles(items)
        if dupes:
            print(f'\n{name} 重复标题:')
            for duplicate in dupes:
                positions = '、'.join(str(position) for position in duplicate['positions'])
                print(f'  第{positions}条: "{duplicate["title"]}"')
        return len(dupes)

    reading_dupes = check_duplicates('朗诵', reading_items)
    retell_dupes = check_duplicates('复述', retell_items)
    speech_dupes = check_duplicates('演讲', speech_items)

    # 构建最终数据
    reading_full = build_reading_items(reading_items)
    retell_full = build_retell_items(retell_items)
    speech_full = build_speech_items(speech_items)

    # 保存 JSON
    os.makedirs(output_dir, exist_ok=True)

    # 1. 朗诵训练（用于云导入）
    reading_output = os.path.join(output_dir, 'reading_import_v3.json')
    with open(reading_output, 'w', encoding='utf-8') as f:
        json.dump(reading_full, f, ensure_ascii=False, indent=2)
    print(f'\n朗诵训练数据已保存至: {reading_output}')

    # 2. 复述训练（用于云导入）
    retell_output = os.path.join(output_dir, 'retell_import_v3.json')
    with open(retell_output, 'w', encoding='utf-8') as f:
        json.dump(retell_full, f, ensure_ascii=False, indent=2)
    print(f'复述训练数据已保存至: {retell_output}')

    # 3. 演讲训练（用于替换 extended-training-data.js）
    speech_output = os.path.join(output_dir, 'speech_items_v3.json')
    with open(speech_output, 'w', encoding='utf-8') as f:
        json.dump(speech_full, f, ensure_ascii=False, indent=2)
    print(f'演讲训练数据已保存至: {speech_output}')

    # 汇总
    summary = {
        'version': 4,
        'reading_count': len(reading_items),
        'retell_count': len(retell_items),
        'speech_count': len(speech_items),
        'total': len(reading_items) + len(retell_items) + len(speech_items),
        'expected': {'reading': 214, 'retell': 255, 'speech': 111, 'total': 580},
        'reading_first_title': reading_items[0]['title'] if reading_items else '',
        'reading_last_title': reading_items[-1]['title'] if reading_items else '',
        'retell_first_title': retell_items[0]['title'] if retell_items else '',
        'retell_last_title': retell_items[-1]['title'] if retell_items else '',
        'speech_first_title': speech_items[0]['title'] if speech_items else '',
        'speech_last_title': speech_items[-1]['title'] if speech_items else '',
        'reading_dupes': reading_dupes,
        'retell_dupes': retell_dupes,
        'speech_dupes': speech_dupes,
        'categories': {
            'reading': build_category_summary('reading', reading_items, reading_full, files['reading']),
            'retelling': build_category_summary('retelling', retell_items, retell_full, files['retell']),
            'speech': build_category_summary('speech', speech_items, speech_full, files['speech'])
        }
    }
    summary_output = os.path.join(output_dir, 'parse_summary.json')
    with open(summary_output, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f'\n解析摘要已保存至: {summary_output}')

    combined_reading_retelling = {
        'reading': reading_full,
        'retelling': retell_full
    }
    combined_output = os.path.join(output_dir, 'yangqin_training_v3_reading_retelling.json')
    with open(combined_output, 'w', encoding='utf-8') as f:
        json.dump(combined_reading_retelling, f, ensure_ascii=False, indent=2)

    all_output = os.path.join(output_dir, 'yangqin_training_v4_all.json')
    with open(all_output, 'w', encoding='utf-8') as f:
        json.dump({
            'reading': reading_full,
            'retelling': retell_full,
            'speech': speech_full
        }, f, ensure_ascii=False, indent=2)
    print(f'三类训练汇总数据已保存至: {all_output}')

    # 验证预期数量
    expected = {'reading': 214, 'retell': 255, 'speech': 111}
    actual = {'reading': len(reading_items), 'retell': len(retell_items), 'speech': len(speech_items)}
    errors = []
    for k in expected:
        if actual[k] != expected[k]:
            errors.append(f'{k}: 预期 {expected[k]} 条，实际 {actual[k]} 条')
    if errors:
        print('\n[ERROR] 数量不匹配:')
        for e in errors:
            print(f'  {e}')
        sys.exit(1)
    else:
        print('\n[OK] 所有板块数量与预期一致。')

    # 验证首条和末条标题
    expected_titles = {
        'reading_first': '允许偏航，是成年人最高级的自律',
        'reading_last': '放弃取悦别人，学会珍爱自己',
        'retell_first': '1885次拒绝，史泰龙的逆袭之路',
        'retell_last': '敲动生命的大铁球',
        'speech_first': '佛得角，从一无所有，终成逆袭范本',
        'speech_last': '（查理·卓别林）致人类',
    }

    checks = {
        'reading_first': reading_items[0]['title'] if reading_items else '',
        'reading_last': reading_items[-1]['title'] if reading_items else '',
        'retell_first': retell_items[0]['title'] if retell_items else '',
        'retell_last': retell_items[-1]['title'] if retell_items else '',
        'speech_first': speech_items[0]['title'] if speech_items else '',
        'speech_last': speech_items[-1]['title'] if speech_items else '',
    }

    for key, expected_title in expected_titles.items():
        if checks[key] != expected_title:
            print(f'[WARN] {key} 不匹配: 预期="{expected_title}", 实际="{checks[key]}"')

    print('\n解析完成。')


if __name__ == '__main__':
    main()
