import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';

export default function TemplateInstanceNode({ data, selected }) {
  const theme = useTheme();
  const title = data?.title ?? 'Template Instance';
  const summary = data?.__collapsedIssueSummary;
  const errorCount = summary?.ERROR ?? 0;
  const warningCount = summary?.WARNING ?? 0;
  const hasIssues = (errorCount + warningCount + (summary?.INFO ?? 0)) > 0;

  const borderColor = selected
    ? theme.palette.primary.main
    : errorCount > 0
      ? theme.palette.error.main
      : warningCount > 0
        ? theme.palette.warning.main
        : theme.palette.divider;

  return (
    <Box
      sx={{
        position: 'relative',
        height: '100%',
        width: '100%',
        borderRadius: 1,
        border: `1px solid ${borderColor}`,
        backgroundColor: theme.palette.background.paper,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 1
      }}
    >
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'text.secondary' }}>
          {title}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 650, mt: 0.25 }}>
          Collapsed
        </Typography>
        {hasIssues ? (
          <Typography variant="caption" sx={{ mt: 0.25, display: 'block', color: errorCount > 0 ? 'error.main' : 'warning.main' }}>
            {errorCount > 0 ? `${errorCount} error${errorCount === 1 ? '' : 's'}` : `${warningCount} warning${warningCount === 1 ? '' : 's'}`}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
