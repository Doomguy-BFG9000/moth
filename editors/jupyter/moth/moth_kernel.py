"""A Jupyter kernel for Moth (DESIGN §122). Each cell runs through `moth kernel` as `moth notebook` runs a
Markdown file's blocks: a cell has what the cells before it made, a cell whose last line is a value shows it,
and a cell that fails keeps nothing it made. What a cell says comes as it's said, its mistakes come as
Jupyter's errors, `ask` asks in the notebook, and stopping a cell (Jupyter's interrupt) stops only that cell:
what the cells before it made stays.

    python moth_kernel.py install                 # this folder as the "Moth" kernel, for this user
    python moth_kernel.py install --sys-prefix    # or for this Python's environment (a virtualenv's, conda's)
    jupyter lab                                   # then a new notebook, Moth

moth is found where the MOTH variable says, else on PATH. What cells may do is MOTH_KERNEL_ALLOW, the --allow
flags `moth run` takes, "--allow-all" if it isn't set: a notebook's code is the person's own, as a Python
kernel's is. MothSession and execute need nothing but Python; MothKernel needs ipykernel.

How it talks to `moth kernel`: a line on its input names a file holding a cell's code. Before the cell runs,
`moth kernel` writes a line of byte 1 and "moth-cell"; then the cell's output and mistakes come as they're
written; then a line of byte 1 and "moth-done" on the error output, and one of byte 1 and "moth-done ok" or
"moth-done failed" on the output. The cell's program has `moth kernel`'s input, so when its output stops part
of the way through a line (a Moth program only does that when it asks), that's a question, whose answer is
written to the input as a line.
"""

import codecs
import os
import queue
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

__version__ = "1.0.0"
MARK = "\x01"
CELL = MARK + "moth-cell"
DONE = MARK + "moth-done"
# how long the output must stay part of the way through a line before that's taken for a question
QUESTION_WAIT = 0.25


class Ran:
    """What running a cell did: whether it went well, what it said and what went wrong (`mistakes`, its error
    output), whether it was stopped (`interrupted`), whether it asked what nothing could answer (`unanswered`),
    and whether `moth kernel` itself stopped (`ended`), after which the session can run nothing more."""

    def __init__(self):
        self.ok = False
        self.output = ""
        self.mistakes = ""
        self.interrupted = False
        self.unanswered = False
        self.ended = False


class MothSession:
    """`moth kernel`, running, and the cells given to it."""

    def __init__(self, moth=None, flags=None, cwd=None):
        moth = moth or os.environ.get("MOTH") or shutil.which("moth")
        if not moth:
            raise RuntimeError("can't find moth: put it on PATH, or set MOTH to where it is")
        if flags is None:
            flags = os.environ.get("MOTH_KERNEL_ALLOW", "--allow-all").split()
        self.moth, self.flags, self.cwd = moth, list(flags), cwd or os.getcwd()
        self.folder = tempfile.mkdtemp(prefix="moth-kernel-")
        self.count = 0
        # a process group of its own, so the interrupt Jupyter sends this kernel's group reaches this one alone:
        # interrupt() stops the cell, and `moth kernel`, with the names the cells made, stays
        own_group = {"start_new_session": True} if os.name == "posix" else {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
        self.process = subprocess.Popen([moth, "kernel", *flags], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, cwd=self.cwd, **own_group)
        self.events = queue.Queue()
        for name, stream in (("out", self.process.stdout), ("err", self.process.stderr)):
            threading.Thread(target=self._read, args=(name, stream), daemon=True).start()

    def _read(self, name, stream):
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        fd = stream.fileno()
        while True:
            try:
                got = os.read(fd, 65536)
            except OSError:
                got = b""
            if not got:
                self.events.put((name, None))
                return
            self.events.put((name, decoder.decode(got).replace("\r\n", "\n")))

    def alive(self):
        return self.process.poll() is None

    def run(self, code, on_output=None, on_question=None, number=None):
        """A cell's code run: a Ran. on_output, if given, gets what the cell says, whole lines at a time, as it
        says them; on_question gets each question's prompt and gives the answer, or None if nothing can
        answer it, which stops the cell. number, Jupyter's for the cell, is what its mistakes call it ("cell
        4"), if that's past the last cell's."""
        ran = Ran()
        if not self.alive():
            ran.ended = True
            ran.mistakes = "the Moth kernel has stopped: restart it\n"
            return ran
        self.count += 1
        path = os.path.join(self.folder, "cell%d.moth" % self.count)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(code)
        said = []

        def say(text):
            if text:
                said.append(text)
                if on_output:
                    on_output(text)

        out = ""  # what's come on the output and isn't dealt with yet
        err = ""
        started = False
        result = None  # "ok" or "failed", once the output's last line has come
        err_done = False
        echo = ""  # an answer, which the cell's program shows after its question, and which isn't shown again
        answered = 0.0
        last_out = time.monotonic()
        interrupting = False
        try:
            self._send(path if number is None else "%d %s" % (number, path))
            while result is None or not err_done:
                try:  # an interrupt, wherever it comes in this, stops the cell
                    name, text = self._next()
                    if name is not None and text is None:  # moth kernel has stopped
                        ran.ended = True
                        break
                    if name == "err":
                        err += text
                        if DONE + "\n" in err:
                            err = err[:err.index(DONE + "\n")]
                            err_done = True
                    elif name == "out":
                        last_out = time.monotonic()
                        if echo:
                            if text.startswith(echo):
                                text, echo = text[len(echo):], ""
                            elif echo.startswith(text):
                                echo, text = echo[len(text):], ""
                            else:
                                echo = ""
                        out += text
                        if not started and CELL + "\n" in out:
                            out = out[out.index(CELL + "\n") + len(CELL) + 1:]
                            started = True
                        if started and result is None:
                            if DONE in out and "\n" in out[out.index(DONE):]:
                                at = out.index(DONE)
                                result = out[at + len(DONE):out.index("\n", at)].strip()
                                say(out[:at])
                                out = ""
                            elif "\n" in out:
                                whole = out.rindex("\n") + 1
                                say(out[:whole])
                                out = out[whole:]
                    if echo and time.monotonic() - answered > 1:  # a program that doesn't show the answer
                        echo = ""
                    if interrupting and result is None:
                        self.interrupt()  # again, for a cell that was still being built
                    elif (started and result is None and out and MARK not in out and not echo and self.alive()
                          and time.monotonic() - last_out >= QUESTION_WAIT):
                        prompt, out = out, ""
                        try:
                            answer = on_question(prompt) if on_question else None
                        except KeyboardInterrupt:
                            raise
                        except Exception:  # a frontend that can't answer after all
                            answer = None
                        if answer is None:
                            ran.unanswered = interrupting = True
                            if not self.interrupt():
                                ran.ended = True
                                break
                        else:
                            answer = str(answer).replace("\r", "").split("\n")[0]
                            echo = answer + "\n"
                            answered = time.monotonic()
                            self._send(answer)
                except KeyboardInterrupt:
                    ran.interrupted = interrupting = True
                    ran.unanswered = False
                    if not self.interrupt():
                        ran.ended = True
                        break
        except BrokenPipeError:
            ran.ended = True
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
        if ran.ended:
            say(out)
            ran.mistakes = err.replace(DONE + "\n", "") + "the Moth kernel stopped while it ran the cell\n"
            self.close()
        else:
            ran.mistakes = err
            ran.ok = result == "ok" and not ran.interrupted and not ran.unanswered
        ran.output = "".join(said)
        return ran

    def _next(self):
        """the next piece of what moth kernel said, as (output's name, text, or None at its end); or (None, "")
        when nothing has come for a moment"""
        try:
            return self.events.get(timeout=0.05)
        except queue.Empty:
            return None, ""

    def _send(self, line):
        self.process.stdin.write((line + "\n").encode("utf-8"))
        self.process.stdin.flush()

    def interrupt(self):
        """The program running the cell, stopped, and `moth kernel` kept: yes if that could be done (or there
        was no such program yet), no if `moth kernel` had to be stopped too, which ends the session."""
        if not self.alive():
            return False
        found = _children(self.process.pid)
        if found is None:  # no way to find it: everything is stopped
            self._kill_all()
            return False
        for pid in found:
            try:
                os.kill(pid, signal.SIGKILL if hasattr(signal, "SIGKILL") else signal.SIGTERM)
            except OSError:
                pass
        return True

    def _kill_all(self):
        if os.name == "posix":
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except OSError:
                pass
        else:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(self.process.pid)], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
        try:
            self.process.kill()
            self.process.wait(timeout=10)
        except (OSError, subprocess.TimeoutExpired):
            pass

    def close(self):
        if self.alive():
            try:
                self.process.stdin.write(b"\n")
                self.process.stdin.flush()
                self.process.wait(timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                self._kill_all()
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            try:
                stream.close()
            except OSError:
                pass
        shutil.rmtree(self.folder, ignore_errors=True)


def _children(pid):
    """The processes a process started, and the ones they started, as process ids; or None where they can't be
    found (Windows without psutil)."""
    try:
        import psutil

        return [p.pid for p in psutil.Process(pid).children(recursive=True)]
    except ImportError:
        pass
    except Exception:
        return []
    if not os.path.isdir("/proc"):
        return None
    parents = {}
    for entry in os.listdir("/proc"):
        if entry.isdigit():
            try:
                with open("/proc/%s/stat" % entry, "rb") as f:
                    stat = f.read().decode("utf-8", "replace")
                parents.setdefault(int(stat[stat.rindex(")") + 2:].split()[1]), []).append(int(entry))
            except (OSError, ValueError, IndexError):
                pass
    found = []
    waiting = [pid]
    while waiting:
        for child in parents.get(waiting.pop(), []):
            found.append(child)
            waiting.append(child)
    return found


def execute(session, code, silent, allow_stdin, send, ask, number=None):
    """A cell run for Jupyter: what it says sent as it's said, with send("stdout", text); what it wrote to its
    error output, if it went well, with send("stderr", text); and a mistake with send("error", content). ask
    gets a question's prompt and gives the answer; number is Jupyter's for the cell. What's given back is the execute reply's content, all but
    execution_count, and the session to use next (a new one if `moth kernel` stopped)."""
    if not code.strip():
        return {"status": "ok", "payload": [], "user_expressions": {}}, session

    def shown(text):
        if not silent:
            send("stdout", text)

    ran = session.run(code, shown, ask if allow_stdin else None, None if silent else number)
    if ran.ok:
        if ran.mistakes and not silent:
            send("stderr", ran.mistakes)
        return {"status": "ok", "payload": [], "user_expressions": {}}, session
    lines = ran.mistakes.rstrip("\n").split("\n") if ran.mistakes.strip() else []
    if ran.interrupted:
        error = {"ename": "KeyboardInterrupt", "evalue": "the cell was stopped, and nothing it made is kept",
                 "traceback": ["Stopped: nothing the cell made is kept"]}
    elif ran.unanswered:
        error = {"ename": "Mistake", "evalue": "the cell asks a question, but nothing can answer it here",
                 "traceback": ["the cell asks a question, but nothing can answer it here"]}
    else:
        evalue = next((line for line in lines if line.strip()), "the cell failed")
        error = {"ename": "Mistake", "evalue": evalue, "traceback": lines or [evalue]}
    if ran.ended:
        session = MothSession(moth=session.moth, flags=session.flags, cwd=session.cwd)
        error["traceback"] = error["traceback"] + ["", "Moth started again: what the cells before made is gone"]
    if not silent:
        send("error", error)
    return {"status": "error", **error}, session


def kernel_class():
    from ipykernel.kernelbase import Kernel

    class MothKernel(Kernel):
        implementation = "moth_kernel"
        implementation_version = __version__
        language = "moth"
        language_version = ""
        language_info = {"name": "moth", "mimetype": "text/x-moth", "file_extension": ".moth", "pygments_lexer": "text"}
        banner = "Moth, a programming language that reads like plain English"
        help_links = [{"text": "Moth", "url": "https://github.com/samyyy2423/moth"}]

        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self.moth = MothSession()

        def do_execute(self, code, silent, store_history=True, user_expressions=None, allow_stdin=False, **kwargs):
            def send(kind, content):
                if kind == "error":
                    self.send_response(self.iopub_socket, "error", content)
                else:
                    self.send_response(self.iopub_socket, "stream", {"name": kind, "text": content})

            self._allow_stdin = allow_stdin  # as IPython's kernel does, so raw_input asks the frontend
            reply, self.moth = execute(self.moth, code, silent, allow_stdin, send, self.raw_input, self.execution_count)
            reply["execution_count"] = self.execution_count
            return reply

        def do_shutdown(self, restart):
            self.moth.close()
            if restart:
                self.moth = MothSession(moth=self.moth.moth, flags=self.moth.flags, cwd=self.moth.cwd)
            return {"status": "ok", "restart": restart}

    return MothKernel


def install(user=True, prefix=None):
    """This folder's kernel, with a kernel.json that runs this file with this Python, as the "moth" kernelspec:
    where it went."""
    from jupyter_client.kernelspec import KernelSpecManager
    import json

    here = os.path.dirname(os.path.abspath(__file__))
    staged = tempfile.mkdtemp(prefix="moth-kernelspec-")
    try:
        shutil.copy(os.path.join(here, "moth_kernel.py"), staged)
        with open(os.path.join(here, "kernel.json"), encoding="utf-8") as f:
            spec = json.load(f)
        spec["argv"][0] = sys.executable
        with open(os.path.join(staged, "kernel.json"), "w", encoding="utf-8") as f:
            json.dump(spec, f, indent=2)
        return KernelSpecManager().install_kernel_spec(staged, "moth", user=user, prefix=prefix)
    finally:
        shutil.rmtree(staged, ignore_errors=True)


def main(argv):
    if argv[:1] == ["install"]:
        if "--sys-prefix" in argv:
            where = install(user=False, prefix=sys.prefix)
        elif "--prefix" in argv and argv.index("--prefix") + 1 < len(argv):
            where = install(user=False, prefix=argv[argv.index("--prefix") + 1])
        else:
            where = install()
        print("installed the Moth kernel in " + where)
        return
    from ipykernel.kernelapp import IPKernelApp

    IPKernelApp.launch_instance(kernel_class=kernel_class())


if __name__ == "__main__":
    main(sys.argv[1:])
