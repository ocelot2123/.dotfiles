# dotfiles

Heavily inspired by (stolen from) [dmmulroy/.dotfiles](https://github.com/dmmulroy/.dotfiles).

Bare git repo for tracking config files.

## Setup on a new machine

```bash
# Clone bare repo
git clone --bare git@github.com:ocelot2123/.dotfiles.git ~/.dotfiles

# Add alias to bashrc
echo "alias dotfiles='git --git-dir=\$HOME/.dotfiles --work-tree=\$HOME'" >> ~/.bashrc
source ~/.bashrc

# Checkout files (may warn about overwriting existing files)
dotfiles checkout

# Hide untracked files from status
dotfiles config status.showUntrackedFiles no
```

If checkout fails due to existing files, back them up first:

```bash
mkdir -p ~/.dotfiles-backup
dotfiles checkout 2>&1 | grep -E "^\s+" | awk '{print $1}' | xargs -I{} mv {} ~/.dotfiles-backup/{}
dotfiles checkout
```

## Usage

```bash
# Check status
dotfiles status

# See tracked files
dotfiles ls-tree --name-only -r HEAD

# Add a file
dotfiles add ~/.config/opencode/somefile.md

# Add all changed tracked files
dotfiles add -u

# Commit
dotfiles commit -m "message"

# Push
dotfiles push

# Pull updates
dotfiles pull
```
