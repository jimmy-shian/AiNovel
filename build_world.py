# -*- coding: utf-8 -*-
import json
import os
import sys

if sys.platform.startswith('win'):
    import io
    if getattr(sys.stdout, 'encoding', '').lower() != 'utf-8':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    if getattr(sys.stderr, 'encoding', '').lower() != 'utf-8':
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')


def build():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    stories_dir = os.path.join(base_dir, 'stories')
    world_path = os.path.join(base_dir, 'world.json')

    print(f"Scanning stories in: {stories_dir} ...")
    if not os.path.exists(stories_dir):
        print(f"Error: Stories directory '{stories_dir}' does not exist.")
        sys.exit(1)

    stories = {}
    for filename in sorted(os.listdir(stories_dir)):
        if filename.endswith('.json'):
            story_id = os.path.splitext(filename)[0]
            file_path = os.path.join(stories_dir, filename)
            print(f"Loading story: {story_id} from {filename}")
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    story_data = json.load(f)
                stories[story_id] = {
                    "title": story_data.get("title", "無標題"),
                    "description": story_data.get("description", ""),
                    "file": f"stories/{filename}"
                }
            except Exception as e:
                print(f"Error reading {filename}: {e}")
                sys.exit(1)

    world_data = {
        "stories": stories
    }

    print(f"Writing compiled world data to: {world_path} ...")
    try:
        with open(world_path, 'w', encoding='utf-8') as f:
            json.dump(world_data, f, ensure_ascii=False, indent=2)
        print("Success: world.json built successfully.")
    except Exception as e:
        print(f"Error writing world.json: {e}")
        sys.exit(1)

if __name__ == '__main__':
    build()
