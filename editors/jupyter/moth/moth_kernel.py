"""A Jupyter kernel for Moth: each cell runs through `moth kernel`, as `moth notebook` runs a Markdown file's
blocks, so a cell has what the cells before it made, a cell's last line shows its value, and a cell that
fails keeps nothing it made (DESIGN §107).

    python moth_kernel.py install        # this folder as the "Moth" kernel, for this user
    jupyter notebook                     # then New, Moth

moth is found where the MOTH variable says, else on PATH. What cells may do is MOTH_KERNEL_ALLOW, the --allow
flags `moth run` takes, "--allow-all" if it isn't set: a notebook's code is the person's own, as a Python
kernel's is. MothSession needs nothing but Python; MothKernel needs ipykernel.
"""

import os
import shutil
import subprocess
import sys
import tempfile

MARK = "\x01"
__version__ = "1.0.0"


class MothSession:
    """`moth kernel`, running, and the cells given to it."""

    def __init__(self, moth=None, flags=None, cwd=None):
        moth = moth or os.environ.get("MOTH") or shutil.which("moth")
        if not moth:
            raise RuntimeError("can't find moth: put it on PATH, or set MOTH to where it is")
        if flags is None:
            flags = os.environ.get("MOTH_KERNEL_ALLOW", "--allow-all").split()
        self.folder = tempfile.mkdtemp(prefix="moth-kernel-")
        self.count = 0
        self.process = subprocess.Popen([moth, "kernel", *flags], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, cwd=cwd or os.getcwd())

    def run(self, code):
        """A cell's code run: what it said, and whether it went well."""
        if self.process.poll() is not None:
            return "the Moth kernel has stopped: restart it", False
        self.count += 1
        path = os.path.join(self.folder, "cell%d.moth" % self.count)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(code)
        self.process.stdin.write((path + "\n").encode("utf-8"))
        self.process.stdin.flush()
        said = []
        started = False
        while True:
            line = self.process.stdout.readline()
            if not line:
                return "".join(said) + "the Moth kernel stopped while it ran the cell\n", False
            text = line.decode("utf-8", errors="replace").replace("\r\n", "\n")
            if text.startswith(MARK + "moth-cell"):
                started = True
            elif text.startswith(MARK + "moth-done"):
                os.remove(path)
                return "".join(said), text.strip() == MARK + "moth-done ok"
            elif started:
                said.append(text)

    def close(self):
        if self.process.poll() is None:
            try:
                self.process.stdin.write(b"\n")
                self.process.stdin.flush()
                self.process.wait(timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                self.process.kill()
        shutil.rmtree(self.folder, ignore_errors=True)


def kernel_class():
    from ipykernel.kernelbase import Kernel

    class MothKernel(Kernel):
        implementation = "moth_kernel"
        implementation_version = __version__
        language = "moth"
        language_version = ""
        language_info = {"name": "moth", "mimetype": "text/x-moth", "file_extension": ".moth", "pygments_lexer": "text"}
        banner = "Moth, a programming language that reads like plain English"

        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self.session_moth = MothSession()

        def do_execute(self, code, silent, store_history=True, user_expressions=None, allow_stdin=False, **kwargs):
            if not code.strip():
                return {"status": "ok", "execution_count": self.execution_count, "payload": [], "user_expressions": {}}
            said, ok = self.session_moth.run(code)
            if ok:
                if said and not silent:
                    self.send_response(self.iopub_socket, "stream", {"name": "stdout", "text": said})
                return {"status": "ok", "execution_count": self.execution_count, "payload": [], "user_expressions": {}}
            lines = said.rstrip("\n").split("\n")
            mistake = next((line for line in reversed(lines) if line.strip() and ": " in line), lines[-1] if lines else "")
            error = {"ename": "Mistake", "evalue": mistake, "traceback": [said.rstrip("\n")]}
            if not silent:
                self.send_response(self.iopub_socket, "error", error)
            return {"status": "error", "execution_count": self.execution_count, **error}

        def do_shutdown(self, restart):
            self.session_moth.close()
            if restart:
                self.session_moth = MothSession()
            return {"status": "ok", "restart": restart}

    return MothKernel


def install(user=True, prefix=None):
    """This folder, with a kernel.json that runs this file with this Python, as the "moth" kernelspec."""
    from jupyter_client.kernelspec import KernelSpecManager
    import json

    here = os.path.dirname(os.path.abspath(__file__))
    staged = tempfile.mkdtemp(prefix="moth-kernelspec-")
    try:
        shutil.copy(os.path.join(here, "moth_kernel.py"), staged)
        spec = {"argv": [sys.executable, "{resource_dir}/moth_kernel.py", "-f", "{connection_file}"],
                "display_name": "Moth", "language": "moth"}
        with open(os.path.join(staged, "kernel.json"), "w", encoding="utf-8") as f:
            json.dump(spec, f, indent=2)
        return KernelSpecManager().install_kernel_spec(staged, "moth", user=user, prefix=prefix)
    finally:
        shutil.rmtree(staged, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "install":
        print("installed the Moth kernel in " + install(user="--sys-prefix" not in sys.argv, prefix=sys.prefix if "--sys-prefix" in sys.argv else None))
    else:
        from ipykernel.kernelapp import IPKernelApp

        IPKernelApp.launch_instance(kernel_class=kernel_class())
