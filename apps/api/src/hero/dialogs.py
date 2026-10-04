"""Native file dialog. Tests inject their own callable and never open this."""


def ask_open_file() -> str | None:
    """Open the system file dialog. Returns the path, or None when cancelled."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
        selected = filedialog.askopenfilename(parent=root)
    finally:
        root.destroy()
    if not selected:
        return None
    return str(selected)
