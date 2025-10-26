import Joi from 'joi';

export const validate = (schema) => {
    return (req, res, next) => {
        const validationOptions = {
            abortEarly: false,
            allowUnknown: true,
            stripUnknown: true,
        };

        try {
            const { error } = schema.validate(req.body, validationOptions);
            
            if (error) {
                const errors = error.details.map(detail => ({
                    field: detail.path[0],
                    message: detail.message
                }));

                return res.status(400).json({
                    status: 'error',
                    message: 'Validation failed',
                    errors
                });
            }

            next();
        } catch (err) {
            return res.status(500).json({
                status: 'error',
                message: 'Internal server error during validation'
            });
        }
    };
};

