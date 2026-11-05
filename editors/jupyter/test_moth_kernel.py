"""Tests for the Jupyter kernel, moth/moth_kernel.py (DESIGN §114), which machine.test.js runs with MOTH set to the
moth it built:

- MothSession and execute against a stand-in for `moth kernel`, in Python, that talks as it does and runs each
  cell in a program of its own, as moth does: output in pieces, questions, mistakes, stopping a cell, and moth
  kernel itself stopping;
- the same against moth itself, if MOTH says where it is (or it's on PATH): what cells keep, show and ask;
- and, where ipykernel and jupyter_client are installed, the kernel installed and driven as Jupyter drives it.

    MOTH=./moth python editors/jupyter/test_moth_kernel.py
"""

import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "moth"))
import moth_kernel as mk  # noqa: E402

MOTH = os.environ.get("MOTH") or shutil.which("moth")
try:
    import ipykernel  # noqa: F401
    import jupyter_client  # noqa: F401

    JUPYTER = True
except ImportError:
    JUPYTER = False

# The stand-in: `kernel`, which reads cells' files as moth kernel does and runs each in `cell`, a program of
# its own with its input and outputs; and `cell`, whose lines are commands: say, piece (no line end), sleep,
# warn (on the error output), fail (a mistake), ask (as Moth's ask does, showing the answer after it), number
# (the number the cell was given), hang (a program of its own that never ends) and die (moth kernel stops).
STAND_IN_KERNEL = r'''
import os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
out, err = sys.stdout.buffer, sys.stderr.buffer
def write(stream, text):
    stream.write(text.encode("utf-8"))
    stream.flush()
while True:
    write(out, " ")
    line = sys.stdin.buffer.readline().decode("utf-8")
    if not line.strip():
        break
    write(out, line)
    number, path = "", line.strip()
    if path.split(" ", 1)[0].isdigit():
        number, path = path.split(" ", 1)
    write(out, "\x01moth-cell\n")
    ended = subprocess.call([sys.executable, os.path.join(here, "cell"), path, number])
    if ended == 99:
        sys.exit(3)
    write(err, "\x01moth-done\n")
    write(out, "\x01moth-done " + ("ok" if ended == 0 else "failed") + "\n")
'''

STAND_IN_CELL = r'''
import subprocess, sys, time
out, err = sys.stdout.buffer, sys.stderr.buffer
def write(stream, text):
    stream.write(text.encode("utf-8"))
    stream.flush()
failed = False
for command in open(sys.argv[1], encoding="utf-8").read().split("\n"):
    verb, _, rest = command.partition(" ")
    if verb == "say":
        write(out, rest + "\n")
    elif verb == "piece":
        write(out, rest)
    elif verb == "sleep":
        time.sleep(float(rest))
    elif verb == "warn":
        write(err, rest + "\n")
    elif verb == "fail":
        write(err, rest + "\n")
        failed = True
        break
    elif verb == "ask":
        write(out, rest + " ")
        answer = sys.stdin.buffer.readline().decode("utf-8")
        if not answer:
            write(err, "there was no answer to this question: the input ended\n")
            failed = True
            break
        write(out, answer)
        write(out, "got " + answer.rstrip("\n") + "\n")
    elif verb == "number":
        write(out, sys.argv[2] + "\n")
    elif verb == "hang":
        subprocess.call([sys.executable, "-c", "import time; time.sleep(120)"])
        failed = True
    elif verb == "die":
        sys.exit(99)
sys.exit(1 if failed else 0)
'''


def stand_in():
    """A session of the stand-in's, in a folder of its own: [python, "kernel"] there runs it."""
    folder = tempfile.mkdtemp(prefix="moth-stand-in-")
    for name, text in (("kernel", STAND_IN_KERNEL), ("cell", STAND_IN_CELL)):
        with open(os.path.join(folder, name), "w", encoding="utf-8") as f:
            f.write(text)
    session = mk.MothSession(moth=sys.executable, flags=[], cwd=folder)
    session.stand_in_folder = folder
    return session


def finish(session):
    session.close()
    folder = getattr(session, "stand_in_folder", None)
    if folder:
        shutil.rmtree(folder, ignore_errors=True)


def interrupt_in(seconds):
    """Jupyter's interrupt, as it comes on Linux: SIGINT to this process, which Python makes a KeyboardInterrupt"""
    timer = threading.Timer(seconds, lambda: os.kill(os.getpid(), signal.SIGINT))
    timer.start()
    return timer


class TheProtocol(unittest.TestCase):
    """MothSession, against the stand-in"""

    def setUp(self):
        self.session = stand_in()

    def tearDown(self):
        finish(self.session)

    def test_what_a_cell_says_comes_a_line_at_a_time_and_nothing_before_the_cell(self):
        given = []
        ran = self.session.run("say one\npiece tw\nsleep 0.05\nsay o\nsay héllo 😀", given.append)
        self.assertEqual((ran.ok, ran.output, ran.mistakes), (True, "one\ntwo\nhéllo 😀\n", ""))
        self.assertTrue(all(piece.endswith("\n") for piece in given), given)
        self.assertEqual("".join(given), ran.output)

    def test_a_question_is_answered_and_its_answer_is_not_shown_twice(self):
        asked = []
        ran = self.session.run("say before\nask Name?\nsay after", None, lambda prompt: asked.append(prompt) or "Ana")
        self.assertEqual(asked, ["Name? "])
        self.assertEqual((ran.ok, ran.output), (True, "before\ngot Ana\nafter\n"))
        ran = self.session.run("ask Again?", None, lambda prompt: "two\nlines")
        self.assertEqual((ran.ok, ran.output), (True, "got two\n"))

    def test_a_question_nothing_answers_stops_the_cell(self):
        started = time.monotonic()
        ran = self.session.run("say before\nask Name?\nsay after")
        self.assertEqual((ran.ok, ran.unanswered, ran.interrupted, ran.ended, ran.output), (False, True, False, False, "before\n"))
        self.assertLess(time.monotonic() - started, 10)
        ran = self.session.run("ask Name?", None, lambda prompt: None)
        self.assertTrue(ran.unanswered)
        self.assertEqual(self.session.run("say still here").output, "still here\n")

    def test_a_mistake_and_what_went_to_the_error_output(self):
        ran = self.session.run("say before\nfail cell 2:1:1: no such thing\nsay never")
        self.assertEqual((ran.ok, ran.output, ran.mistakes), (False, "before\n", "cell 2:1:1: no such thing\n"))
        ran = self.session.run("warn careful\nsay fine")
        self.assertEqual((ran.ok, ran.output, ran.mistakes), (True, "fine\n", "careful\n"))

    def test_the_number_jupyter_gives_a_cell(self):
        self.assertEqual(self.session.run("number", number=7).output, "7\n")
        self.assertEqual(self.session.run("number").output, "\n")

    @unittest.skipUnless(os.name == "posix", "Jupyter interrupts a kernel with SIGINT on Linux")
    def test_stopping_a_cell_stops_its_program_and_keeps_moth_kernel(self):
        started = time.monotonic()
        timer = interrupt_in(1)
        try:
            ran = self.session.run("say started\nhang\nsay never")
        finally:
            timer.cancel()
        self.assertEqual((ran.ok, ran.interrupted, ran.ended, ran.output), (False, True, False, "started\n"))
        self.assertLess(time.monotonic() - started, 30)
        self.assertEqual(self.session.run("say still here").output, "still here\n")

    def test_moth_kernel_stopping(self):
        ran = self.session.run("say last words\ndie")
        self.assertEqual((ran.ok, ran.ended, ran.output), (False, True, "last words\n"))
        self.assertTrue(ran.mistakes.endswith("the Moth kernel stopped while it ran the cell\n"), ran.mistakes)
        ran = self.session.run("say hello")
        self.assertEqual((ran.ended, ran.mistakes), (True, "the Moth kernel has stopped: restart it\n"))

    def test_close_ends_moth_kernel_and_takes_its_files_away(self):
        self.session.run("say hi")
        folder = self.session.folder
        self.session.close()
        self.assertFalse(self.session.alive())
        self.assertFalse(os.path.exists(folder))


class Executing(unittest.TestCase):
    """execute, which MothKernel.do_execute is, against the stand-in"""

    def setUp(self):
        self.session = stand_in()
        self.sent = []

    def tearDown(self):
        finish(self.session)

    def send(self, kind, content):
        self.sent.append((kind, content))

    def run_cell(self, code, silent=False, allow_stdin=False, answer="Ana", number=1):
        reply, self.session = mk.execute(self.session, code, silent, allow_stdin, self.send, lambda prompt: answer, number)
        return reply

    def test_output_mistakes_and_the_error_output(self):
        self.assertEqual(self.run_cell("say hi\nwarn careful"), {"status": "ok", "payload": [], "user_expressions": {}})
        reply = self.run_cell("say before\nfail cell 2:1:5: there is no item 9\nsay never")
        error = {"ename": "Mistake", "evalue": "cell 2:1:5: there is no item 9", "traceback": ["cell 2:1:5: there is no item 9"]}
        self.assertEqual(reply, {"status": "error", **error})
        self.assertEqual(self.sent, [("stdout", "hi\n"), ("stderr", "careful\n"), ("stdout", "before\n"), ("error", error)])

    def test_silent_cells_send_nothing_and_empty_ones_run_nothing(self):
        self.assertEqual(self.run_cell("say hi\nfail oh no", silent=True)["status"], "error")
        self.assertEqual(self.run_cell("  \n\n")["status"], "ok")
        self.assertEqual(self.sent, [])

    def test_questions_only_where_the_frontend_can_answer(self):
        self.assertEqual(self.run_cell("ask Name?", allow_stdin=True)["status"], "ok")
        self.assertEqual(self.sent, [("stdout", "got Ana\n")])
        reply = self.run_cell("ask Name?")
        self.assertEqual((reply["status"], reply["evalue"]), ("error", "the cell asks a question, but nothing can answer it here"))

    def test_the_number_goes_to_moth_kernel_unless_the_cell_is_silent(self):
        self.run_cell("number", number=12)
        self.run_cell("number", number=13, silent=True)
        self.assertEqual(self.sent, [("stdout", "12\n")])

    def test_after_moth_kernel_stops_there_is_a_new_one(self):
        old = self.session
        reply = self.run_cell("die")
        self.assertEqual(reply["status"], "error")
        self.assertEqual(reply["traceback"][-1], "Moth started again: what the cells before made is gone")
        self.assertIsNot(self.session, old)
        self.assertEqual(self.run_cell("say back")["status"], "ok")
        self.assertEqual(self.sent[-1], ("stdout", "back\n"))


@unittest.skipUnless(os.name == "posix" and os.path.isdir("/proc"), "finds processes in /proc")
class FindingPrograms(unittest.TestCase):
    def test_the_programs_a_program_started_and_theirs(self):
        parent = subprocess.Popen([sys.executable, "-c", "import subprocess, sys; subprocess.call([sys.executable, '-c', "
                                   "'import subprocess, sys; subprocess.call([sys.executable, \"-c\", \"import time; time.sleep(60)\"])'])"])
        try:
            found = []
            for _ in range(100):
                found = mk._children(parent.pid)
                if len(found) == 2:
                    break
                time.sleep(0.05)
            self.assertEqual(len(found), 2)
            self.assertNotIn(parent.pid, found)
        finally:
            for pid in mk._children(parent.pid) or []:
                os.kill(pid, signal.SIGKILL)
            parent.kill()
            parent.wait()


@unittest.skipUnless(MOTH, "set MOTH to where moth is")
class WithMoth(unittest.TestCase):
    """MothSession against moth kernel itself"""

    def setUp(self):
        self.folder = tempfile.mkdtemp(prefix="moth-kernel-test-")
        self.session = mk.MothSession(moth=MOTH, flags=["--allow-all"], cwd=self.folder)

    def tearDown(self):
        self.session.close()
        left = os.listdir(self.folder)
        shutil.rmtree(self.folder, ignore_errors=True)
        self.assertEqual(left, [], "what moth kernel built or kept was left behind")

    def ran(self, code, answer=None, number=None):
        ran = self.session.run(code, None, (lambda prompt: answer) if answer is not None else None, number)
        return ran.ok, ran.output, ran.mistakes

    def test_cells_keep_what_the_ones_before_made_and_show_their_last_value(self):
        self.assertEqual(self.ran('set xs to list of 1, 2, 3\nsay "made " + length of xs\n'), (True, "made 3\n", ""))
        self.assertEqual(self.ran("xs"), (True, "[1, 2, 3]\n", ""))
        self.assertEqual(self.ran("to double with n\n    return n * 2\nend\ndouble(item 3 of xs)\n\n"), (True, "6\n", ""))
        self.assertEqual(self.ran('set greeting to "hi"\ngreeting'), (True, "hi\n", ""))
        self.assertEqual(self.ran("double(greeting + 1)")[0], False)

    def test_a_cell_that_fails_keeps_nothing(self):
        self.ran("set xs to list of 1, 2, 3")
        self.assertEqual(self.ran("set xs to list of 9\nsay item 9 of xs"),
                         (False, "", "cell 2:2:5: there is no item 9, the list only has 1 item\nsay item 9 of xs\n    ^\n"))
        self.assertEqual(self.ran("say xs"), (True, "[1, 2, 3]\n", ""))
        self.assertEqual(self.ran("say 1 +")[0], False)
        self.assertEqual(self.ran("say length of xs"), (True, "3\n", ""))

    def test_mistakes_call_a_cell_by_jupyter_s_number(self):
        self.assertEqual(self.ran("say nope", number=5)[2].split("\n")[0], "cell 5:1:5: 'nope' has no value yet (give it one with 'set nope to ...')")
        self.assertEqual(self.ran("say nope", number=3)[2].split("\n")[0][:7], "cell 6:", "a number that goes back would be a cell's again")

    def test_a_question_and_a_cell_stopped(self):
        self.assertEqual(self.ran('set name to ask "Name?"\nsay "hi " + name', answer="Ana"), (True, "hi Ana\n", ""))
        ran = self.session.run('set name to ask "Again?"')
        self.assertEqual((ran.ok, ran.unanswered), (False, True))
        if os.name == "posix":
            timer = interrupt_in(1.5)
            try:
                ran = self.session.run("set name to \"Bo\"\nrepeat while yes\n    set z to 1\nend")
            finally:
                timer.cancel()
            self.assertEqual((ran.ok, ran.interrupted, ran.ended), (False, True, False))
        self.assertEqual(self.ran("name"), (True, "Ana\n", ""))

    def test_files_beside_the_notebook_and_two_kernels_in_one_folder(self):
        with open(os.path.join(self.folder, "lib.moth"), "w", encoding="utf-8") as f:
            f.write("to triple with n\n    return n * 3\nend\n")
        other = mk.MothSession(moth=MOTH, flags=["--allow-all"], cwd=self.folder)
        try:
            self.assertEqual(self.ran('use "lib.moth"\nset x to triple(2)'), (True, "", ""))
            self.assertTrue(other.run("set x to 100").ok)
            self.assertEqual(self.ran("x"), (True, "6\n", ""))
            self.assertEqual(other.run("x").output, "100\n")
        finally:
            other.close()
        os.remove(os.path.join(self.folder, "lib.moth"))


@unittest.skipUnless(MOTH and JUPYTER, "needs moth (MOTH), ipykernel and jupyter_client")
class InJupyter(unittest.TestCase):
    """The kernel installed in a folder of its own, and run as Jupyter runs it"""

    @classmethod
    def setUpClass(cls):
        from jupyter_client.manager import start_new_kernel

        cls.folder = tempfile.mkdtemp(prefix="moth-jupyter-")
        cls.saved = {name: os.environ.get(name) for name in ("JUPYTER_PATH", "MOTH")}
        cls.where = mk.install(user=False, prefix=cls.folder)
        os.environ["JUPYTER_PATH"] = os.path.join(cls.folder, "share", "jupyter")
        os.environ["MOTH"] = os.path.abspath(MOTH)
        cls.km, cls.kc = start_new_kernel(kernel_name="moth", cwd=cls.folder)

    @classmethod
    def tearDownClass(cls):
        cls.kc.stop_channels()
        cls.km.shutdown_kernel(now=False)
        for name, value in cls.saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        shutil.rmtree(cls.folder, ignore_errors=True)

    def run_cell(self, code, answer=None):
        got = []

        def output(message):
            kind, content = message["header"]["msg_type"], message["content"]
            if kind == "stream":
                got.append((content["name"], content["text"]))
            elif kind == "error":
                got.append(("error", content["ename"], content["evalue"]))

        def asked(message):
            got.append(("asked", message["content"]["prompt"]))
            self.kc.input(answer)

        reply = self.kc.execute_interactive(code, output_hook=output, stdin_hook=asked, allow_stdin=answer is not None, timeout=120)
        return reply["content"]["status"], got

    def test_a_notebook(self):
        with open(os.path.join(self.where, "kernel.json"), encoding="utf-8") as f:
            self.assertIn('"' + sys.executable.replace("\\", "\\\\") + '"', f.read())
        info = self.kc.kernel_info(reply=True)["content"]
        self.assertEqual((info["implementation"], info["language_info"]["name"], info["language_info"]["file_extension"]),
                         ("moth_kernel", "moth", ".moth"))
        self.assertEqual(self.run_cell('set xs to list of 1, 2, 3\nsay "made"'), ("ok", [("stdout", "made\n")]))
        self.assertEqual(self.run_cell("xs"), ("ok", [("stdout", "[1, 2, 3]\n")]))
        self.assertEqual(self.run_cell("say item 9 of xs"),
                         ("error", [("error", "Mistake", "cell 3:1:5: there is no item 9, the list only has 3 items")]))
        self.assertEqual(self.run_cell('set name to ask "Name?"\nsay "hi " + name', answer="Ana"),
                         ("ok", [("asked", "Name? "), ("stdout", "hi Ana\n")]))
        self.assertEqual(self.run_cell('say "a"\nsay "b" to the error output'), ("ok", [("stdout", "a\n"), ("stderr", "b\n")]))
        if os.name == "posix":
            timer = threading.Timer(2, self.km.interrupt_kernel)
            timer.start()
            self.assertEqual(self.run_cell("repeat while yes\n    set z to 1\nend"),
                             ("error", [("error", "KeyboardInterrupt", "the cell was stopped, and nothing it made is kept")]))
        self.assertEqual(self.run_cell("name"), ("ok", [("stdout", "Ana\n")]))
        self.km.restart_kernel(now=False)
        self.kc.wait_for_ready(timeout=60)
        status, got = self.run_cell("xs")
        self.assertEqual((status, got[0][:2]), ("error", ("error", "Mistake")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
