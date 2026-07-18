# Code Guidelines

Before writing code, inspect the relevant files and understand the existing architecture, conventions, dependencies, and data flow. Do not rewrite working components unnecessarily. After making changes, run the relevant formatter, linter, type checker, and tests, then fix any issues caused by the changes.

## Python Coding Guidelines

When writing or modifying Python code, follow these rules:

1. Prioritize correctness, readability, maintainability, security, and only then performance.

2. Write clear and explicit code.
   - Prefer simple implementations over clever or overly compact solutions.
   - Avoid unnecessary abstractions and complexity.

3. Use descriptive names.
   - Variables should describe the data they contain.
   - Functions should describe the action they perform.
   - Classes should describe the entity or responsibility they represent.
   - Avoid vague names such as `data`, `result`, `temp`, `x`, or `obj` unless the context is obvious.

4. Follow Python conventions.
   - Use `snake_case` for functions and variables.
   - Use `PascalCase` for classes.
   - Use `UPPER_CASE` for constants.
   - Follow PEP 8 formatting conventions.

5. Keep functions focused.
   - Each function should have one clear responsibility.
   - Avoid functions that combine API calls, validation, transformation, persistence, and presentation.
   - Break large functions into smaller reusable units.

6. Avoid code duplication.
   - Extract repeated logic into functions, classes, or shared utilities.
   - Do not create abstractions for logic that appears only once unless it clearly improves readability.

7. Use type hints.
   - Add type annotations to function arguments and return values.
   - Use precise types instead of generic `dict`, `list`, or `Any` when practical.
   - Use `Optional`, unions, TypedDict, dataclasses, or Pydantic models where appropriate.

8. Validate all external input.
   - Validate data received from users, APIs, files, databases, environment variables, and language models.
   - Check required values, expected types, ranges, formats, and allowed options.
   - Fail early with clear error messages.

9. Handle errors explicitly.
   - Catch only exceptions that can be handled meaningfully.
   - Never use a bare `except`.
   - Never silently ignore exceptions.
   - Preserve the original exception when raising a more descriptive error.
   - Include enough context in error messages to diagnose the failure.

10. Do not hide failures.
    - Avoid returning empty values when an operation has failed unless this behavior is explicitly expected.
    - Do not replace errors with misleading fallback data.
    - Make fallback behavior explicit and observable.

11. Use logging instead of `print`.
    - Use the appropriate log level: debug, info, warning, error, or exception.
    - Log important operations, failures, retries, and fallback behavior.
    - Never log passwords, tokens, personal data, or confidential information.

12. Protect secrets and configuration.
    - Never hardcode API keys, passwords, tokens, or connection strings.
    - Read configuration from environment variables or a secure secret manager.
    - Validate required configuration during application startup.
    - Keep `.env` files out of version control.
    - Provide a safe `.env.example` when needed.

13. Avoid mutable default arguments.

    Bad:

    ```python
    def add_item(item, items=[]):
        ...
    ```

    Good:

    ```python
    def add_item(item, items=None):
        if items is None:
            items = []
    ```

14. Use `is` only for identity checks.
    - Use `is None` and `is not None`.
    - Use `==` for value comparison.

15. Do not modify a collection while iterating over it.
    - Create a new collection or iterate over a copy when filtering or removing elements.

16. Use context managers.
    - Use `with` for files, database connections, locks, sessions, and other resources that require cleanup.

17. Separate concerns.
    - Keep business logic independent from APIs, frameworks, databases, and UI code.
    - Separate validation, data access, domain logic, integrations, and presentation.
    - Avoid placing the entire application in one module.

18. Minimize global state.
    - Avoid mutable global variables.
    - Pass dependencies explicitly.
    - Use dependency injection or dedicated service objects when appropriate.

19. Use asynchronous code only when justified.
    - Use `async` primarily for I/O-bound operations.
    - Do not use async for CPU-heavy work unless it is combined with an appropriate execution model.
    - Do not mix synchronous and asynchronous code incorrectly.
    - Always await coroutine calls.

20. Design external integrations defensively.
    - Set explicit timeouts for API and database calls.
    - Handle rate limits and temporary failures.
    - Use retries only for recoverable errors.
    - Use exponential backoff and a maximum retry limit.
    - Avoid retrying validation errors or permanent failures.
    - Validate external responses before using them.

21. Write testable code.
    - Keep business logic deterministic where possible.
    - Avoid hidden dependencies on global state, time, network, or environment variables.
    - Inject external clients so they can be mocked or replaced in tests.

22. Write automated tests.
    - Test expected behavior.
    - Test invalid inputs.
    - Test empty inputs and boundary values.
    - Test failure paths and external service failures.
    - Test edge cases, not only the happy path.
    - Prefer testing observable behavior over internal implementation details.

23. Document decisions, not obvious syntax.
    - Add comments when the reason behind a decision is not obvious.
    - Do not add comments that merely repeat the code.
    - Add docstrings to public functions, classes, and modules when they clarify behavior, constraints, or exceptions.

24. Use safe database access.
    - Always use parameterized SQL queries.
    - Never construct SQL by concatenating user-controlled strings.
    - Keep transaction boundaries explicit.
    - Roll back transactions when failures occur.

25. Avoid unsafe execution.
    - Do not use `eval` or `exec` with external input.
    - Avoid unsafe deserialization.
    - Validate filenames and paths.
    - Prevent path traversal when handling uploaded or user-provided files.

26. Manage dependencies carefully.
    - Declare dependencies in `pyproject.toml`.
    - Use a dependency manager such as `uv`.
    - Pin or constrain important dependency versions.
    - Remove unused dependencies.
    - Separate production and development dependencies.

27. Use standard tools consistently.
    - Use Ruff for linting and formatting.
    - Use pytest for testing.
    - Use mypy or Pyright for static type checking.
    - Use pre-commit hooks to catch issues before commits.

28. Consider memory and performance.
    - Do not load large datasets into memory unnecessarily.
    - Prefer generators, streaming, batching, or pagination for large data.
    - Avoid repeated API calls, database queries, and expensive calculations.
    - Use caching only when invalidation and freshness requirements are clear.
    - Measure performance before optimizing.

29. Preserve backward compatibility unless a breaking change is intentional.
    - Do not unexpectedly change public function signatures, response schemas, configuration names, or stored data formats.
    - Clearly document intentional breaking changes.

30. Keep changes focused.
    - Modify only what is required for the task.
    - Avoid unrelated refactoring unless it is necessary for correctness or safety.
    - Preserve existing behavior unless the requirements explicitly request a change.

31. Review generated code before completing the task.
    - Check imports.
    - Check type consistency.
    - Check variable scope.
    - Check exception handling.
    - Check sync and async usage.
    - Check resource cleanup.
    - Check edge cases.
    - Check security risks.
    - Check that the code can run without missing placeholders.

32. Do not invent unavailable components.
    - Do not assume that files, functions, environment variables, APIs, database tables, or dependencies exist.
    - Inspect the existing codebase before referencing existing components.
    - Clearly identify any assumptions that cannot be verified.

33. Do not leave incomplete production code.
    - Avoid placeholders such as `pass`, `TODO`, mock return values, or pseudocode unless explicitly requested.
    - Return complete, runnable implementations when enough context is available.

34. When requirements are ambiguous, choose the safest and least disruptive implementation.
    - Preserve existing behavior.
    - State important assumptions.
    - Avoid making irreversible or security-sensitive decisions without clear requirements.

35. Before finishing, confirm that the code is:
    - Correct
    - Readable
    - Typed
    - Validated
    - Tested
    - Secure
    - Observable
    - Maintainable
    - Consistent with the existing project

36. Example for function writing:
```python
def create_sequences(
    df: pd.DataFrame,
    feature_cols: list[str],
    target_col: str,
    seq_len: int,
    label_source: str = "date",  # or "ticker"
):
    """
    Builds sliding window sequences from a dataframe grouped by ticker.

    Parameters:
        df:           Input DataFrame (must include 'Ticker' and 'Date' columns)
        feature_cols: List of feature column names
        target_col:   Name of the target column
        seq_len:      Sequence length for each input sample
        label_source: Either 'date' or 'ticker' to determine what the third return array contains

    Returns:
        X: np.ndarray of shape (samples, seq_len, n_features)
        y: np.ndarray of shape (samples, 1)
        t: np.ndarray of shape (samples,) containing either tickers or dates per sample
    """
    X, y, t = [], [], []

    for _, g in tqdm(df.groupby("Ticker"), desc="Building sequences"):
        g = g.sort_values("Date")
        data = g[feature_cols].values.astype(np.float32)
        target = g[target_col].values.astype(np.float32)

        n = len(g) - seq_len
        if n <= 0:
            continue

        for i in range(n):
            j = i + seq_len
            X.append(data[i:j])
            y.append(target[j])

            if label_source == "date":
                t.append(g["Date"].iloc[j])
            elif label_source == "ticker":
                t.append(g["Ticker"].iloc[j])
            else:
                raise ValueError(f"Invalid label_source '{label_source}', must be 'date' or 'ticker'")

    return (
        np.array(X, dtype=np.float32),
        np.array(y, dtype=np.float32).reshape(-1, 1),
        np.array(t),
    )
```
