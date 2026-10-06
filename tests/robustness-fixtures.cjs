/* SPDX-License-Identifier: GPL-3.0-or-later
 * Representative LLM diagram fragments: no document class or explicit packages.
 * These are exercised through the production normalizer and real WASM engine.
 */
'use strict';
module.exports = [
 ['ams-fractions-binom', String.raw`\begin{tikzpicture}
\node {$P(X=k)=\binom{n}{k}\,\dfrac{1}{2^n}$};
\end{tikzpicture}`],
 ['ams-aligned-cases', String.raw`\begin{tikzpicture}
\node at (0,1) {$\begin{aligned}x+y&=3\\x-y&=1\end{aligned}$};
\node at (0,-1) {$f(x)=\begin{cases}x^2&x\geq0\\-x&x<0\end{cases}$};
\end{tikzpicture}`],
 ['ams-matrix-operator', String.raw`\begin{tikzpicture}
\node {$A=\begin{pmatrix}1&2\\0&1\end{pmatrix},\quad\operatorname{rank}(A)=2$};
\end{tikzpicture}`],
 ['ams-declared-operator-raw', String.raw`\DeclareMathOperator*{\argmin}{arg\,min} % The renderer must terminate this preamble comment.
\node {$x^*=\argmin_{x\in X} f(x)$};`],
 ['preamble-body-noindent-boundary', String.raw`\DeclareMathOperator{\tr}{tr}
\noindent\begin{tikzpicture}
\node {$\tr(A)=2$};
\end{tikzpicture}`],
 ['custom-derivative-declaration-comment', String.raw`\newcommand% This derivative belongs to the source, not the physics package.
{\dv}[2]{#1/#2}
\begin{tikzpicture}
\node {$\dv{x}{t}=v$};
\end{tikzpicture}`],
 ['ams-symbols-alphabets', String.raw`\begin{tikzpicture}
\node {$x\in\mathbb{R},\quad\mathfrak{g},\quad\nexists x<0,\quad a\lesssim b$};
\end{tikzpicture}`],
 ['mathtools-overlap-definition', String.raw`\begin{tikzpicture}
\node {$S\coloneqq\sum_{\mathclap{1\leq i\leq n}}i$};
\end{tikzpicture}`],
 ['mathtools-declared-delimiter', String.raw`\DeclarePairedDelimiter{\abs}{\lvert}{\rvert}
\begin{tikzpicture}\node {$\abs*{\dfrac{-1}{2}}=\dfrac{1}{2}$};\end{tikzpicture}`],
 ['bold-math-vectors', String.raw`\begin{tikzpicture}
\draw[->] (0,0)--(2,1) node[right] {$\bm{v}+\bm{\alpha}$};
\end{tikzpicture}`],
 ['unicode-math-and-text-labels', String.raw`\begin{tikzpicture}
\node at (0,1) {$α + β ≤ Ω$};
\node at (0,0) {10 µF};
\node at (0,-1) {x → y};
\end{tikzpicture}`],
 ['chemistry-reaction', String.raw`\begin{tikzpicture}
\node {$\ce{2H2 + O2 -> 2H2O}$};
\end{tikzpicture}`],
 ['siunitx-values-units-angle', String.raw`\begin{tikzpicture}
\node at (0,1) {Distance: \SI{2.5}{\metre}; time: \qty{4}{\second}};
\node at (0,0) {Speed unit: \unit{\metre\per\second}};
\node at (0,-1) {Count: \num{1.23e4}; angle: \ang{30}};
\end{tikzpicture}`],
 ['siunitx-circuit-labels', String.raw`\begin{circuitikz}[american]
\draw (0,0) to[V,l={\qty{5}{\volt}}] (0,2)
to[R,l={\SI{4.7}{\kilo\ohm}}] (3,2)
to[C,l={\qty{100}{\micro\farad}}] (3,0) -- (0,0);
\end{circuitikz}`],
 ['circuitikz-tikzpicture-rectifier-user-example', String.raw`\begin{tikzpicture}
\draw (0,0) node[ground]{} to[sV,l=$v_e(t)$] (0,3)
      to[D,l=$D$] (3,3)
      -- (5,3);
\draw (3,3) to[C,l=$C_L$] (3,0) node[ground]{};
\draw (5,3) to[R,l=$R_L$] (5,0) node[ground]{};
\draw[->] (5.7,0.2) -- (5.7,2.8) node[midway,right] {$v_s$};
\end{tikzpicture}`],
 ['circuitikz-tikzpicture-path-components', String.raw`\begin{tikzpicture}
\draw (0,0) to[R,l=$R$] (2,0) to[L,l=$L$] (4,0)
      to[C,l=$C$] (4,-2) -- (0,-2) -- (0,0);
\end{tikzpicture}`],
 ['circuitikz-accented-mathrm-user-example', String.raw`\begin{tikzpicture}
\draw (0,0) node[ground]{} to[sV,l=$v_e(t)$] (0,3)
      to[R,l=$r_{GBF}$] (2.5,3)
      to[battery1,l=$V_S$] (4.5,3)
      -- (6,3);

\draw (8,3) -- (6,3);
\draw (8,3) to[R,l=$R_L$] (8,0) node[ground]{};

\draw[fill] (6,3) circle (1.5pt);
\draw[fill] (6,0) circle (1.5pt);
\draw (6,0) node[ground]{};

\draw[<->] (6.6,0.2)--(6.6,2.8)
 node[midway,right] {$E_{Th}=V_{\mathrm{à\,vide}}$};
\end{tikzpicture}`],
 ['mathrm-explicit-text-accents', String.raw`\begin{tikzpicture}
\node at (0,1) {$V_{\mathrm{\`a\,vide}}$};
\node at (0,0) {$I_{\mathrm{r\'eseau}}$};
\node at (0,-1) {$U_{\mathrm{cr\^{e}te}}$};
\end{tikzpicture}`],
 ['mathrm-accented-label-script-fonts', String.raw`\begin{tikzpicture}
\node[font=\itshape] at (0,0) {$\mathrm{à\,vide}_{\mathrm{réseau}_{\mathrm{crête}}}$};
\end{tikzpicture}`],
 ['circuitikz-tikzpicture-ground-node', String.raw`\begin{tikzpicture}
\draw (0,1) -- (0,0) node[ground]{};
\end{tikzpicture}`],
 ['circuitikz-tikzpicture-op-amp-node', String.raw`\begin{tikzpicture}
\node[op amp] (amp) at (0,0) {};
\draw (amp.+) -- ++(-1,0) node[left] {$v_+$};
\draw (amp.-) -- ++(-1,0) node[left] {$v_-$};
\draw (amp.out) -- ++(1,0) node[right] {$v_o$};
\end{tikzpicture}`],
 ['tikz-native-iec-circuit', String.raw`\usetikzlibrary{circuits.ee.IEC}
\begin{tikzpicture}[circuit ee IEC]
\draw (0,0) node[ground]{} to[resistor={info={$R$}}] (0,2);
\end{tikzpicture}`],
 ['tikz-custom-circuit-key-names', String.raw`\tikzset{ground/.style={circle,draw,inner sep=2pt},R/.style={dashed}}
\begin{tikzpicture}
\draw (0,0) node[ground] {A} to[R] (2,0) node[ground] {B};
\end{tikzpicture}`],
 ['siunitx-quantity-comment-separated-arguments', String.raw`\begin{tikzpicture}
\node at (0,0) {$\qty{5}% value comment
{\metre}$};
\node at (0,-1) {$\qty% command comment
[round-mode=places,round-precision=1]% options comment
{2.34}% another value comment
{\metre}$};
\end{tikzpicture}`],
 ['physics-derivatives', String.raw`\begin{tikzpicture}
\node {$\dv{x^2}{x}=2x,\quad\pdv{f}{y}$};
\end{tikzpicture}`],
 ['physics-states-parentheses', String.raw`\begin{tikzpicture}
\node {$\bra{\psi}\ket{\phi}+\qty(x+1)$};
\end{tikzpicture}`],
 ['physics-with-siunitx', String.raw`\begin{tikzpicture}
\node {$\dv{x}{t}=v$};
\node at (0,-1) {$\qty(v+1)$, with $v=\SI{2}{\metre\per\second}$};
\end{tikzpicture}`],
 ['physics-quantity-with-siunitx-no-derivative', String.raw`\begin{tikzpicture}
\node {$\qty(x+1)+\SI{2}{\metre}$};
\end{tikzpicture}`],
 ['array-custom-columns', String.raw`\newcolumntype{C}{>{\centering\arraybackslash}p{1.2cm}}
\begin{tikzpicture}
\node {\begin{tabular}{|C|C|}\hline A&B\\\hline 1&2\\\hline\end{tabular}};
\end{tikzpicture}`],
 ['tikz-position-calc-fit-shapes', String.raw`\begin{tikzpicture}[node distance=18mm]
\node[draw,diamond,aspect=2] (a) {Start};
\node[draw,rounded rectangle,right=of a] (b) {End};
\draw[-{Stealth}] (a)--(b);
\node[draw,dashed,fit=(a)(b),inner sep=4mm] {};
\node at ($(a)!0.5!(b)+(0,-1)$) {midpoint};
\end{tikzpicture}`],
 ['tikz-decorations-brace-snake', String.raw`\begin{tikzpicture}
\draw[decorate,decoration={brace,amplitude=5pt}] (0,1)--(3,1);
\draw[decorate,decoration={snake,amplitude=2pt,segment length=6pt}] (0,0)--(3,0);
\end{tikzpicture}`],
 ['tikz-brace-binary-sign-user-example', String.raw`\begin{tikzpicture}
\node[draw,minimum width=1cm,minimum height=1cm] at (0,0) {1};
\node[draw,minimum width=1cm,minimum height=1cm] at (1,0) {1};
\node[draw,minimum width=1cm,minimum height=1cm] at (2,0) {0};
\node[draw,minimum width=1cm,minimum height=1cm] at (3,0) {1};
\draw[->] (0,-1.3) -- (0,-0.55);
\node at (0,-1.65) {signe $-$};
\draw[decorate,decoration={brace,mirror,amplitude=5pt}]
(0.5,-0.8)--(3.5,-0.8);
\node at (2,-1.45) {valeur absolue $101=5$};
\end{tikzpicture}`],
 ['tikz-decoration-brace-shorthand', String.raw`\begin{tikzpicture}
\draw[decorate,decoration=brace] (0,0)--(3,0);
\end{tikzpicture}`],
 ['tikz-legacy-snakes', String.raw`\begin{tikzpicture}
\draw[snake=snake,segment amplitude=2pt,segment length=6pt] (0,0)--(3,0);
\end{tikzpicture}`],
 ['tikz-3d-plane', String.raw`\begin{tikzpicture}[x={(1cm,0cm)},y={(0.4cm,0.3cm)},z={(0cm,1cm)}]
\begin{scope}[canvas is yz plane at x=1]
\draw[blue] (0,0) rectangle (2,2);
\end{scope}
\draw[->] (0,0,0)--(2,0,0) node[right] {$x$};
\end{tikzpicture}`],
 ['tikzcd-ams-labels', String.raw`\begin{tikzcd}
\mathbb{R}^2 \arrow[r,"{\operatorname{pr}_1}"] \arrow[d,"A"] & \mathbb{R} \arrow[d,"f"] \\
\mathbb{R}^2 \arrow[r,"{\operatorname{pr}_2}"] & \mathbb{R}
\end{tikzcd}`],
 ['pgfplots-fillbetween', String.raw`\begin{axis}[width=5cm,height=4cm,domain=0:2,samples=5]
\addplot[name path=upper] {x+1};
\addplot[name path=lower] {x};
\addplot[blue!15] fill between[of=upper and lower];
\end{axis}`],
 ['pgfplots-groupplots', String.raw`\begin{groupplot}[group style={group size=2 by 1},width=4cm,height=3cm]
\nextgroupplot[title=Increasing]\addplot coordinates {(0,0)(1,1)(2,2)};
\nextgroupplot[title=Decreasing]\addplot coordinates {(0,2)(1,1)(2,0)};
\end{groupplot}`],
 ['pgfplots-statistics-boxplot', String.raw`\begin{axis}[width=4cm,height=4cm,boxplot/draw direction=y]
\addplot+[boxplot prepared={lower whisker=1,lower quartile=2,median=3,upper quartile=4,upper whisker=5}] coordinates {};
\end{axis}`],
 ['pgfplots-polar', String.raw`\begin{polaraxis}[width=5cm,height=5cm,xtick={0,90,180,270}]
\addplot[domain=0:360,samples=17] {1};
\end{polaraxis}`],
 ['pgfplots-dateplot', String.raw`\begin{axis}[date coordinates in=x,xtick=data,xticklabel=\year-\month-\day,width=7cm,height=4cm]
\addplot coordinates {(2026-01-01,1)(2026-01-02,3)(2026-01-03,2)};
\end{axis}`]
];
