import React, { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

export interface ControlledMultiSelectOption {
  label: string;
  value: string;
}

export interface ControlledMultiSelectProps {
  options: ControlledMultiSelectOption[];
  ascii?: boolean;
  onSubmit: (values: string[]) => void;
}

/**
 * A multi-select whose highlighted option is also a valid Enter selection.
 * Refs keep keyboard state current when a terminal delivers multiple keys in
 * one input chunk, while React state drives the rendered frame.
 */
export function ControlledMultiSelect({
  options,
  ascii = false,
  onSubmit,
}: ControlledMultiSelectProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const focusedIndexRef = useRef(0);
  const selectedRef = useRef(selected);

  useInput((input, key) => {
    if (key.downArrow) {
      const nextIndex = Math.min(
        focusedIndexRef.current + 1,
        Math.max(options.length - 1, 0),
      );
      focusedIndexRef.current = nextIndex;
      setFocusedIndex(nextIndex);
    } else if (key.upArrow) {
      const nextIndex = Math.max(focusedIndexRef.current - 1, 0);
      focusedIndexRef.current = nextIndex;
      setFocusedIndex(nextIndex);
    }

    if (input.includes(" ")) {
      const focusedValue = options[focusedIndexRef.current]?.value;
      if (focusedValue) {
        const next = new Set(selectedRef.current);
        if (next.has(focusedValue)) next.delete(focusedValue);
        else next.add(focusedValue);
        selectedRef.current = next;
        setSelected(next);
      }
    }

    if (key.return || input.includes("\r") || input.includes("\n")) {
      const checkedValues = options
        .filter((option) => selectedRef.current.has(option.value))
        .map((option) => option.value);
      const focusedValue = options[focusedIndexRef.current]?.value;
      onSubmit(
        checkedValues.length > 0
          ? checkedValues
          : focusedValue
            ? [focusedValue]
            : [],
      );
    }
  });

  return (
    <Box flexDirection="column">
      {options.map((option, index) => {
        const focused = index === focusedIndex;
        const checked = selected.has(option.value);
        return (
          <Box key={option.value}>
            <Text
              {...(focused ? { color: "cyan" as const } : {})}
              bold={focused}
            >
              {focused ? (ascii ? ">" : "›") : " "} {option.label}
            </Text>
            <Text {...(checked ? { color: "green" as const } : {})}>
              {ascii ? (checked ? " [x]" : " [ ]") : checked ? " ✔" : "  "}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
