import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
CSV = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "experiments.csv"
OUT_DIR = HERE / "plots"

MAPPING_NAMES = {1: "Baseline", 2: "Gizmo"}
METRICS = [
    ("completion_time_s", "Completion time (s)", "Completion time by mapping"),
    ("final_position_error", "Final position error (scene units)", "Position error by mapping"),
    ("final_orientation_error_deg", "Final orientation error (deg)", "Orientation error by mapping"),
    ("mode_switches", "Mode switches (count)", "Mode switches by mapping"),
    ("path_length", "Path length (scene units)", "Path length by mapping"),
]


def load() -> pd.DataFrame:
    df = pd.read_csv(CSV)
    df["mapping_name"] = df["mapping"].map(MAPPING_NAMES)
    n_part = df["participant_id"].nunique()
    print(f"Loaded {len(df)} trials from {CSV.name}")
    print(f"Participants: {n_part} -> {sorted(df['participant_id'].unique())}")
    print(df.groupby("mapping")["trial_number"].count().rename("trials_per_mapping").to_string())
    # Is anyone missin a mapping?
    have = df.groupby("participant_id")["mapping"].nunique()
    incomplete = have[have < 2].index.tolist()
    if incomplete:
        print(f"Note: participants missing one mapping (excluded from paired stats): {incomplete}")
    print()
    return df


def summarize(df: pd.DataFrame) -> pd.DataFrame:
    """Per-mapping central tendency + spread for every metric."""
    rows = []
    for m, name in MAPPING_NAMES.items():
        sub = df[df["mapping"] == m]
        for col, _, _ in METRICS:
            x = sub[col].dropna()
            rows.append({
                "mapping": m,
                "mapping_name": name,
                "metric": col,
                "n": len(x),
                "mean": x.mean(),
                "std": x.std(ddof=1),
                "median": x.median(),
                "iqr": x.quantile(0.75) - x.quantile(0.25),
                "min": x.min(),
                "max": x.max(),
            })
    return pd.DataFrame(rows)


def per_participant(df: pd.DataFrame) -> pd.DataFrame:
    agg = df.groupby(["participant_id", "mapping_name"])[
        ["completion_time_s", "final_position_error", "final_orientation_error_deg"]
    ].mean()
    return agg


def paired_diffs(df: pd.DataFrame, col: str) -> pd.DataFrame:
    pivot = df.pivot_table(index="participant_id", columns="mapping_name", values=col, aggfunc="mean")
    pivot = pivot.dropna()
    if {"Baseline", "Gizmo"}.issubset(pivot.columns):
        pivot["diff (Gizmo - Baseline)"] = pivot["Gizmo"] - pivot["Baseline"]
    return pivot


def plot_boxplots(df: pd.DataFrame, out_dir: Path) -> None:
    out_dir.mkdir(exist_ok=True)

    primary = [
        ("completion_time_s", "Completion time (s)"),
        ("final_position_error", "Position error (units)"),
        ("final_orientation_error_deg", "Orientation error (deg)"),
    ]

    for col, ylabel in primary:
        fig, ax = plt.subplots(figsize=(5, 5))
        data = [df[df["mapping"] == m][col].dropna().values for m in (1, 2)]
        bp = ax.boxplot(data, tick_labels=["Baseline", "Gizmo"], showmeans=True,
                        meanprops=dict(marker="D", markerfacecolor="white", markeredgecolor="black"))
        for i, vals in enumerate(data, start=1):
            jitter = np.random.default_rng(0).uniform(-0.12, 0.12, size=len(vals))
            ax.scatter(np.full_like(vals, i) + jitter, vals, alpha=0.6, s=24, zorder=3)
        ax.set_ylabel(ylabel)
        ax.set_title(f"{ylabel} by mapping")
        ax.grid(axis="y", alpha=0.3)
        fig.tight_layout()
        fig.savefig(out_dir / f"{col}.png", dpi=150)
        plt.close(fig)

    fig, axes = plt.subplots(1, 3, figsize=(13, 4.5))
    for ax, (col, ylabel) in zip(axes, primary):
        data = [df[df["mapping"] == m][col].dropna().values for m in (1, 2)]
        ax.boxplot(data, tick_labels=["Baseline", "Gizmo"], showmeans=True,
                   meanprops=dict(marker="D", markerfacecolor="white", markeredgecolor="black"))
        for i, vals in enumerate(data, start=1):
            jitter = np.random.default_rng(0).uniform(-0.12, 0.12, size=len(vals))
            ax.scatter(np.full_like(vals, i) + jitter, vals, alpha=0.6, s=22, zorder=3)
        ax.set_ylabel(ylabel)
        ax.grid(axis="y", alpha=0.3)
    fig.suptitle("Performance by mapping (Baseline vs Gizmo)", y=1.02)
    fig.tight_layout()
    fig.savefig(out_dir / "combined.png", dpi=150, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    df = load()

    summary = summarize(df)
    pd.set_option("display.width", 160)
    pd.set_option("display.max_columns", 20)
    pd.set_option("display.float_format", lambda v: f"{v:.4f}")

    print("=== Per-mapping summary (all trials) ===")
    print(summary.to_string(index=False))
    print()

    print("=== Per-participant mean per mapping ===")
    print(per_participant(df).to_string())
    print()

    print("=== Paired diffs (Gizmo - Baseline), participants with both mappings ===")
    for col, label in [
        ("completion_time_s", "completion time (s)"),
        ("final_position_error", "position error"),
        ("final_orientation_error_deg", "orientation error (deg)"),
    ]:
        d = paired_diffs(df, col)
        diffs = d["diff (Gizmo - Baseline)"]
        print(f"\n{label}:")
        print(d.to_string())
        print(f"  mean diff = {diffs.mean():.4f}  (negative => Gizmo faster/more precise)")
    print()

    plot_boxplots(df, OUT_DIR)
    print("Done.")


if __name__ == "__main__":
    main()
