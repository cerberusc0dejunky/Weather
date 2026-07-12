import os

# Directories and file extensions to ignore so we don't print junk
IGNORE_DIRS = {'.git', 'node_modules', 'dist', '.gemini', '.vscode'}
IGNORE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.mp4', '.webp', '.pdf', '.zip'}
MAX_BYTES = 200_000

def generate_snapshot():
    page_num = 1
    current_size = 0
    out_file = None
    
    def open_new_file():
        nonlocal out_file, page_num, current_size
        if out_file:
            out_file.close()
            
        os.makedirs("notebooklm", exist_ok=True)
        filename = os.path.join("notebooklm", f"project_snapshot_page{page_num}.txt")
        out_file = open(filename, "w", encoding="utf-8")
        
        page_num += 1
        current_size = 0
        return out_file

    out_file = open_new_file()
    
    for root, dirs, files in os.walk("."):
        # Modifying dirs in-place to skip ignored directories
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and d != "notebooklm"]
        
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            
            # Skip images, binary files, and the snapshot files themselves
            if ext in IGNORE_EXTS or file.startswith("project_snapshot_page") or file == "snapshot.py":
                continue
                
            filepath = os.path.join(root, file)
            
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
            except Exception:
                # Skip binary files or anything that can't be read as plain text
                continue
                
            header = f"\n\n{'='*80}\nFILE: {filepath}\n{'='*80}\n\n"
            text_to_write = header + content
            byte_size = len(text_to_write.encode('utf-8'))
            
            # If a single file is massive, we might technically go slightly over 200k on a page,
            # but this guarantees we cut to a new page immediately after.
            out_file.write(text_to_write)
            current_size += byte_size
            
            if current_size >= MAX_BYTES:
                out_file = open_new_file()

    if out_file:
        out_file.close()
    
    print(f"✅ Snapshot complete! Generated {page_num - 1} pages.")

if __name__ == "__main__":
    generate_snapshot()
