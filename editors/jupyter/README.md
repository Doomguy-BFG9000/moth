# Moth in Jupyter

[Moth](https://github.com/samyyy2423/moth) is a programming language that reads like plain English. This
is a Jupyter kernel for it: notebooks in JupyterLab, Jupyter Notebook, VS Code or anything else that runs
Jupyter kernels, with Moth in their cells.

- **Each cell has what the cells before it made**, as in `moth notebook` and the Moth shell: its
  variables, functions and kinds, and the files it uses.
- **A cell whose last line is a value shows it**: `xs`, `square(4)`, `length of names`.
- **A cell that fails keeps nothing it made.** Its mistake comes as Jupyter's error, with the line and
  where in it, as `cell 3:1:5: there is no item 9, the list only has 3 items`, numbered as Jupyter
  numbers the cell.
- **`ask` asks in the notebook**, in Jupyter's input box.
- **Stopping a cell** (the ■ button, or Interrupt) stops that cell alone: what the cells before it made
  stays. Restarting starts with nothing.

## Installing

You need `moth` (from [the releases](https://github.com/samyyy2423/moth/releases), or `node bootstrap.mjs`
in the repository) on your PATH, or the `MOTH` variable set to where it is, and Python 3.8 or later with
Jupyter:

```bash
pip install jupyterlab                              # or notebook, or just ipykernel for VS Code
python editors/jupyter/moth/moth_kernel.py install  # the "Moth" kernel, for you
jupyter lab                                         # then a new notebook, Moth
```

`install` puts the kernel where Jupyter looks for it, set to run with the Python you ran it with, so that
Python needs ipykernel. `install --sys-prefix` puts it in that Python's environment instead (a virtualenv's,
or conda's), and `install --prefix <folder>` in a folder of your own. `jupyter kernelspec install
editors/jupyter/moth --user` installs the folder as it is, which runs `python` from your PATH.
`jupyter kernelspec remove moth` takes it away.

## What cells may do

A notebook's code is your own, as a Python notebook's is, so cells may read and write files, go online,
start programs and use libraries without asking. `MOTH_KERNEL_ALLOW` narrows that, with the flags `moth run`
takes, before Jupyter starts:

```bash
MOTH_KERNEL_ALLOW="--allow-read --allow-net=api.example.com" jupyter lab
```

## How it works

`moth_kernel.py` is a wrapper kernel, ipykernel's `Kernel` with `do_execute`, that starts `moth kernel` in
the notebook's folder and gives it each cell, in a file of its own. `moth kernel` runs a cell as the Moth
shell runs an entry: a program built from the cells before it and this one, which loads the values the
cells before it kept and keeps its own for the next. Output comes as the cell's program writes it: when its
buffer is half full, or it asks, fails or ends, so the lines of a long cell can come together. Stopping a
cell stops the program running it; on Windows that needs `pip install psutil` to find the program, or
Moth is started again, with nothing kept. DESIGN.md §111 has more.

Its tests run a stand-in for `moth kernel`, moth itself, and, with ipykernel and jupyter_client installed,
the kernel as Jupyter runs it:

```bash
MOTH=./moth python editors/jupyter/test_moth_kernel.py
```
